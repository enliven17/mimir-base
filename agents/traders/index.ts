/**
 * Mimir demo BYOA traders — three Groq-backed agents that stake their own USDC.
 *
 * These exist to make the agents and basket pages real: they register through the
 * same public agent API a third party would use, then stake from their own funded
 * wallets on Base Sepolia. Mimir never holds their keys in a route or a bundle —
 * only this worker process does, exactly like the legacy personas.
 *
 * Deliberately NOT using the spend-permission path: these agents own their wallets,
 * so they sign their own transactions. The permission path exists for agents that
 * cannot sign, and is authorised by the same API either way.
 *
 * Run: npx tsx agents/traders/index.ts
 * Env: TRADER_<NAME>_PRIVATE_KEY, GROQ_API_KEY, DATABASE_URL,
 *      NEXT_PUBLIC_CONTRACT_ADDRESS, BASE_RPC_URL
 *      TRADER_POLL_INTERVAL_MS=900000  (poll cadence, default 15m)
 *      TRADER_MAX_STAKES_PER_CYCLE=1   (stakes per trader per cycle)
 *      TRADER_DRY_RUN=1                (decide and log, stake nothing)
 */

// Groq for the traders regardless of what the rest of the fleet uses: their whole
// point is to be a second, independent opinion from the Gemini-backed council.
process.env.LLM_PROVIDER = "groq";

import { randomUUID } from "node:crypto";

import { createBasePublicClient, getContractAddress, getExplorerTxUrl, weiToEth } from "../../lib/base";
import { agentContractWrite, loadAgentWallet, type AgentWallet } from "../../lib/agent-wallets";
import { callLLM, activeLLMModel, activeLLMProvider, extractJson } from "../../lib/llm";
import { MIMIR_ABI } from "../../lib/mimir-abi";
import { reportingPoll } from "../../lib/ops/heartbeat";
import { AUTHORITY_LEVELS, defaultLimits, REGISTRY_SCHEMA_VERSION, type AgentRecord } from "../../lib/agents/registry";
import { loadAgent, saveAgent } from "../../lib/agents/store";
import { getClaimsByFilter, getChallengersByClaimId } from "../../lib/db";
import { unitsToUsdc, usdcToUnits, USDC_ADDRESS, ERC20_ABI } from "../../lib/usdc";
import { TRADER_PERSONAS, isTraderVerdict, shouldStake, type TraderPersona, type TraderVerdict } from "./personas";

const POLL_INTERVAL_MS = Number(process.env.TRADER_POLL_INTERVAL_MS ?? "900000");
const MAX_STAKES_PER_CYCLE = Number(process.env.TRADER_MAX_STAKES_PER_CYCLE ?? "1");
const DRY_RUN = process.env.TRADER_DRY_RUN === "1";
/** Leave a margin so a trader never spends its last cent of gas mid-cycle. */
const MIN_GAS_ETH = 0.0008;

interface Decision {
  verdict: TraderVerdict;
  confidence: number;
  reasoning: string;
}

function walletFor(persona: TraderPersona): AgentWallet | null {
  try {
    return loadAgentWallet(persona.keyEnv);
  } catch {
    return null;
  }
}

/**
 * Register on first run so the agent appears in the registry and on /agents.
 *
 * Written straight to the store rather than posted to the HTTP API: these are
 * first-party agents in the same process as the database, and a self-call over
 * the network would only add a failure mode. The record is identical either way.
 */
async function ensureRegistered(persona: TraderPersona, wallet: AgentWallet): Promise<AgentRecord> {
  const existing = await loadAgent(persona.agentId);
  if (existing) return existing;

  const now = Date.now();
  const record: AgentRecord = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    agentId: persona.agentId,
    ownerWallet: wallet.address.toLowerCase(),
    operatorWallet: wallet.address.toLowerCase(),
    payoutWallet: wallet.address.toLowerCase(),
    displayName: persona.displayName,
    description: persona.description,
    capabilities: ["council_juror", "researcher"],
    authorityLevel: AUTHORITY_LEVELS.STAKE,
    limits: { ...defaultLimits(), maxPositionUsdc: persona.stakeUsdc, maxDailyExposureUsdc: persona.stakeUsdc * 4 },
    status: "active",
    reputationBps: 0,
    createdAt: now,
    updatedAt: now,
  };
  await saveAgent(record);
  console.log(`[traders] ${persona.emoji} registered ${persona.agentId} (${wallet.address})`);
  return record;
}

function decisionPrompt(persona: TraderPersona, claim: {
  question: string | null; creator_position: string | null; counter_position: string | null;
  category: string; deadline: number; creator_stake: number; total_challenger_stake: number;
  settlement_rule: string | null;
}): string {
  const hoursLeft = Math.max(0, Math.round((claim.deadline * 1000 - Date.now()) / 3_600_000));
  return `${persona.strategy}

## Claim
Question: ${claim.question ?? "(missing)"}
Creator's position: ${claim.creator_position ?? "(unstated)"}
Opposing position: ${claim.counter_position ?? "(unstated)"}
Category: ${claim.category}
Settles: ${claim.settlement_rule ?? "(no rule given)"}
Time remaining: ${hoursLeft}h
Staked so far: creator ${claim.creator_stake} USDC vs challengers ${claim.total_challenger_stake} USDC

## Your decision
You may only take the opposing side, and only with your own money. Say DISAGREE to
stake against the creator's position, AGREE to leave it alone, ABSTAIN if the claim
cannot be judged from what is here.

## Calibrating confidence
Use the whole range. An unanchored 60 for everything is not a judgement.
- 50: a coin flip. Say ABSTAIN instead.
- 55-65: a lean you would not back with money.
- 66-79: you can name the specific evidence that makes your side more likely.
- 80+: the claim needs something unusual to happen in the time left.
Give the number your reasoning actually supports, high or low.

Reply with JSON only:
{"verdict":"AGREE"|"DISAGREE"|"ABSTAIN","confidence":0-100,"reasoning":"one or two sentences in your own voice, naming the specific evidence"}`;
}

async function decide(persona: TraderPersona, claim: Parameters<typeof decisionPrompt>[1]): Promise<Decision> {
  const text = await callLLM(decisionPrompt(persona, claim), {
    maxTokens: 400, jsonOnly: true, temperature: 0.3,
  });
  try {
    const parsed = JSON.parse(extractJson(text) ?? "{}") as Partial<Decision>;
    const verdict = isTraderVerdict(parsed.verdict) ? parsed.verdict : "ABSTAIN";
    const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence ?? 0))));
    return { verdict, confidence, reasoning: String(parsed.reasoning ?? "").slice(0, 300) };
  } catch {
    // An unparsable answer is not a signal to bet on.
    return { verdict: "ABSTAIN", confidence: 0, reasoning: "[unparsable model response]" };
  }
}

async function usdcBalance(address: `0x${string}`): Promise<bigint> {
  return (await createBasePublicClient().readContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [address],
  })) as bigint;
}

/** Claims this trader can still join: open, unexpired, and not already its own. */
async function joinableFor(wallet: AgentWallet) {
  const rows = await getClaimsByFilter({ states: ["open", "active"], orderBy: "deadline_asc", limit: 25 });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const mine = wallet.address.toLowerCase();
  const joinable: typeof rows = [];
  for (const claim of rows) {
    if (claim.deadline <= nowSeconds + 300) continue;      // too close to settle into
    if (claim.creator.toLowerCase() === mine) continue;     // never challenge yourself
    if (claim.visibility !== "public") continue;
    const challengers = await getChallengersByClaimId(claim.id).catch(() => []);
    if (challengers.some((c) => c.address.toLowerCase() === mine)) continue; // one position each
    joinable.push(claim);
  }
  return joinable;
}

async function runTrader(persona: TraderPersona): Promise<void> {
  const wallet = walletFor(persona);
  if (!wallet) {
    console.log(`[traders] ${persona.emoji} ${persona.agentId}: ${persona.keyEnv} not set, skipping`);
    return;
  }
  await ensureRegistered(persona, wallet);

  const [gas, usdc] = await Promise.all([
    createBasePublicClient().getBalance({ address: wallet.address }),
    usdcBalance(wallet.address),
  ]);
  const stakeUnits = usdcToUnits(persona.stakeUsdc);
  console.log(`[traders] ${persona.emoji} ${persona.displayName} · ${weiToEth(gas).toFixed(4)} ETH · ${unitsToUsdc(usdc).toFixed(2)} USDC`);

  if (weiToEth(gas) < MIN_GAS_ETH) return void console.log(`[traders]   out of gas, standing aside`);
  if (usdc < stakeUnits) return void console.log(`[traders]   below ${persona.stakeUsdc} USDC, standing aside`);

  const joinable = await joinableFor(wallet);
  if (joinable.length === 0) return void console.log(`[traders]   nothing joinable this cycle`);

  let staked = 0;
  for (const claim of joinable) {
    if (staked >= MAX_STAKES_PER_CYCLE) break;
    const decision = await decide(persona, claim);
    const take = shouldStake(decision.verdict, decision.confidence, persona);
    console.log(`[traders]   #${claim.id} ${decision.verdict} ${decision.confidence}% ${take ? "→ STAKE" : "→ pass"} · ${decision.reasoning.slice(0, 90)}`);
    if (!take) continue;
    if (DRY_RUN) {
      console.log(`[traders]   DRY_RUN — would stake ${persona.stakeUsdc} USDC on #${claim.id}`);
      staked += 1;
      continue;
    }
    try {
      const tx = await agentContractWrite({
        wallet, contractAddress: getContractAddress(), abi: MIMIR_ABI,
        functionName: "challengeClaim",
        args: [BigInt(claim.id), stakeUnits, ""],
        amountUsdc: String(persona.stakeUsdc),
      });
      console.log(`[traders]   ✓ staked ${persona.stakeUsdc} USDC on #${claim.id} — ${getExplorerTxUrl(tx)}`);
      staked += 1;
    } catch (err) {
      // A revert is one claim's problem, not the cycle's: keep going.
      console.warn(`[traders]   ✗ #${claim.id} stake failed:`, err instanceof Error ? err.message : err);
    }
  }
}

async function poll(): Promise<void> {
  console.log(`\n[traders] ── Cycle at ${new Date().toISOString()} · ${TRADER_PERSONAS.length} traders`);
  for (const persona of TRADER_PERSONAS) {
    try {
      await runTrader(persona);
    } catch (err) {
      console.error(`[traders] ${persona.agentId} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir demo BYOA traders");
  console.log(`  Contract   : ${getContractAddress()}`);
  console.log(`  LLM        : ${activeLLMProvider()} / ${activeLLMModel()}`);
  console.log(`  Traders    : ${TRADER_PERSONAS.map((p) => p.agentId).join(", ")}`);
  console.log(`  Stake      : ${TRADER_PERSONAS[0].stakeUsdc} USDC · max ${MAX_STAKES_PER_CYCLE}/cycle each`);
  console.log(`  Poll every : ${POLL_INTERVAL_MS / 1000}s${DRY_RUN ? " · DRY RUN" : ""}`);
  console.log("═══════════════════════════════════════════════\n");

  void randomUUID; // reserved for per-cycle correlation ids
  const safePoll = () => reportingPoll("traders", "traders", POLL_INTERVAL_MS / 1000, poll);
  await safePoll();
  setInterval(safePoll, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[traders] Fatal:", err);
  process.exit(1);
});
