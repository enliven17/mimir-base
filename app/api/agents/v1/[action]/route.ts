import { randomUUID } from "node:crypto";
import { createBasePublicClient, getContractAddress, isContractConfigured } from "@/lib/base";
import { getUserVSDirect } from "@/lib/contract";
import { publishReasoning } from "@/lib/reasoning/publish";
import {
  AGENT_API_ACTIONS, agentRequestMessage, validateAgentRequestEnvelope,
  type AgentApiAction, type SignedAgentRequest,
} from "@/lib/agents/api";
import {
  AUTHORITY_LEVELS, REGISTRY_SCHEMA_VERSION, authorizeAction, defaultLimits,
  revokeAgent, type AgentRecord, type AgentCapability,
} from "@/lib/agents/registry";
import { auditAgentRequest, consumeNonce, loadAgent, loadIdempotentResponse, saveAgent, saveIdempotentResponse } from "@/lib/agents/store";
import { buildAgentDryRun } from "@/lib/agents/dry-run";
import { ERC20_ABI, USDC_ADDRESS, usdcToUnits } from "@/lib/usdc";
import { getAgentEarningsSummary } from "@/lib/db";

export const dynamic = "force-dynamic";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function verify(address: string, message: string, signature: `0x${string}`): Promise<boolean> {
  try {
    return await createBasePublicClient().verifyMessage({
      address: address as `0x${string}`, message, signature,
    });
  } catch { return false; }
}

async function audit(request: SignedAgentRequest, outcome: string, reason?: string) {
  await auditAgentRequest({
    requestId: randomUUID(), agentId: request.agentId, action: request.action,
    idempotencyKey: request.idempotencyKey, signedAt: request.signedAt,
    nonce: request.nonce, outcome, reason, createdAt: Date.now(),
  });
}

async function register(request: SignedAgentRequest<Record<string, any>>): Promise<Response> {
  const body = request.body;
  const owner = String(body.ownerWallet ?? "").toLowerCase();
  const operator = String(body.operatorWallet ?? "").toLowerCase();
  if (!ADDRESS.test(owner) || !ADDRESS.test(operator)) return json({ error: { message: "invalid owner/operator wallet" } }, 400);
  // The outer request is the owner's explicit grant over the exact record body.
  if (!(await verify(owner, agentRequestMessage(request), request.signature))) {
    return json({ error: { message: "owner signature rejected" } }, 401);
  }
  const operatorProofMessage = `Mimir agent operator proof\nagent: ${request.agentId}\noperator: ${operator}`;
  if (!(await verify(operator, operatorProofMessage, String(body.operatorSignature ?? "") as `0x${string}`))) {
    return json({ error: { message: "operator signature rejected" } }, 401);
  }
  if (!(await consumeNonce(request.agentId, request.nonce, Date.now()))) return json({ error: { message: "nonce replay" } }, 409);
  if (await loadAgent(request.agentId)) return json({ error: { message: "agent already registered" } }, 409);
  const now = Date.now();
  const authority = Math.max(0, Math.min(4, Math.floor(Number(body.authorityLevel ?? 0)))) as AgentRecord["authorityLevel"];
  const requestedCapabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
  const capabilities = requestedCapabilities.filter((c: unknown): c is AgentCapability =>
    typeof c === "string" && ["market_creator", "council_juror", "researcher", "copy_source", "x402_seller"].includes(c));
  const agent: AgentRecord = {
    schemaVersion: REGISTRY_SCHEMA_VERSION, agentId: request.agentId, ownerWallet: owner,
    operatorWallet: operator, payoutWallet: ADDRESS.test(String(body.payoutWallet ?? ""))
      ? String(body.payoutWallet).toLowerCase() : owner,
    displayName: String(body.displayName ?? request.agentId).slice(0, 80),
    description: String(body.description ?? "").slice(0, 500),
    metadataUri: body.metadataUri ? String(body.metadataUri) : undefined,
    metadataHash: body.metadataHash ? String(body.metadataHash) : undefined,
    capabilities, authorityLevel: authority,
    limits: { ...defaultLimits(), ...(body.limits ?? {}) }, status: "active",
    reputationBps: 0, createdAt: now, updatedAt: now,
  };
  // Capabilities above the owner-granted level are dropped, never silently usable.
  agent.capabilities = agent.capabilities.filter((capability) =>
    authorizeAction(agent, { capability, positionUsdc: 0 }).allowed ||
    (capability === "market_creator" && authority >= AUTHORITY_LEVELS.PROPOSE));
  await saveAgent(agent);
  await audit(request, "registered");
  return json({ agent });
}

export async function POST(req: Request, context: { params: Promise<{ action: string }> }): Promise<Response> {
  const { action: rawAction } = await context.params;
  if (!(AGENT_API_ACTIONS as readonly string[]).includes(rawAction)) return json({ error: { message: "unknown action" } }, 404);
  const action = rawAction as AgentApiAction;
  let request: SignedAgentRequest;
  try { request = await req.json() as SignedAgentRequest; }
  catch { return json({ error: { message: "invalid JSON" } }, 400); }
  if (request.action !== action) return json({ error: { message: "action/path mismatch" } }, 400);
  const envelopeErrors = validateAgentRequestEnvelope(request);
  if (envelopeErrors.length) return json({ error: { message: envelopeErrors.join("; ") } }, 400);
  if (action === "register") return register(request as SignedAgentRequest<Record<string, any>>);

  const agent = await loadAgent(request.agentId);
  if (!agent) return json({ error: { message: "agent not found" } }, 404);
  const signer = action === "revoke" ? agent.ownerWallet : agent.operatorWallet;
  if (!(await verify(signer, agentRequestMessage(request), request.signature))) {
    await audit(request, "rejected", "signature");
    return json({ error: { message: "signature rejected" } }, 401);
  }
  const prior = await loadIdempotentResponse(agent.agentId, action, request.idempotencyKey);
  if (prior) return json(prior.body, prior.status);
  if (!(await consumeNonce(agent.agentId, request.nonce, Date.now()))) {
    await audit(request, "rejected", "nonce_replay");
    return json({ error: { message: "nonce replay" } }, 409);
  }

  const body = (request.body ?? {}) as Record<string, any>;
  let result: unknown;
  if (action === "heartbeat") result = { agentId: agent.agentId, status: agent.status, at: Date.now() };
  else if (action === "listPositions") result = { positions: await getUserVSDirect(agent.operatorWallet) };
  else if (action === "listEarnings") {
    const earnings = await getAgentEarningsSummary(agent.payoutWallet).catch(() => ({ ownerFeesAtomic: 0n, unclaimedAtomic: 0n, x402Atomic: 0n }));
    result = { payoutWallet: agent.payoutWallet, ownerFeesAtomic: earnings.ownerFeesAtomic.toString(),
      unclaimedAtomic: earnings.unclaimedAtomic.toString(), x402Atomic: earnings.x402Atomic.toString() };
  }
  else if (action === "revoke") {
    const revoked = revokeAgent(agent, { requestedBy: signer, reason: String(body.reason ?? "owner revoked") });
    if (!revoked.ok) return json({ error: { message: revoked.reason } }, 403);
    await saveAgent(revoked.agent); result = { agent: revoked.agent };
  } else if (action === "publishReasoning") {
    const gate = authorizeAction(agent, { capability: "researcher", requestsThisHour: Number(body.requestsThisHour ?? 0) });
    if (!gate.allowed) return json({ error: { message: gate.reason, detail: gate.detail } }, 403);
    result = await publishReasoning({ ...(body as any), agentId: agent.agentId });
  } else {
    const capability: AgentCapability = action === "proposeMarket" || action === "createMarket" || action === "dryRun"
      ? "market_creator" : "council_juror";
    const proposalOnly = action === "proposeMarket";
    const gate = authorizeAction(agent, {
      capability, category: body.category, settlementMode: body.settlementMode,
      positionUsdc: Number(body.positionUsdc ?? body.stakeUsdc ?? 0),
      exposureTodayUsdc: Number(body.exposureTodayUsdc ?? 0),
      activeMarkets: Number(body.activeMarkets ?? 0), requestsThisHour: Number(body.requestsThisHour ?? 0),
      proposalOnly,
    } as any);
    if (!gate.allowed) return json({ error: { message: gate.reason, detail: gate.detail } }, 403);
    if (action === "dryRun") {
      let allowance = 0n;
      if (isContractConfigured()) {
        try {
          allowance = await createBasePublicClient().readContract({
            address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
            args: [agent.operatorWallet as `0x${string}`, getContractAddress()],
          }) as bigint;
        } catch { /* report zero; dry-run stays safe */ }
      }
      result = buildAgentDryRun({
        principalUsdc: Number(body.principalUsdc ?? body.stakeUsdc ?? 0),
        grossPayoutUsdc: Number(body.grossPayoutUsdc ?? body.stakeUsdc ?? 0),
        outcome: body.outcome ?? "creator_wins", allowanceAtomic: allowance,
        requiredAtomic: usdcToUnits(Number(body.stakeUsdc ?? body.positionUsdc ?? 0)),
        platformFeeBps: Number(body.platformFeeBps ?? 0),
        agentOwnerFeeBps: Number(body.agentOwnerFeeBps ?? 0),
        platformRecipient: String(body.platformRecipient ?? agent.ownerWallet),
        ownerRecipient: agent.payoutWallet, policy: gate,
      });
    } else result = action === "proposeMarket"
      ? { disposition: "review", proposal: body, moderationRequired: true }
      : { allowed: true, simulated: false, contract: getContractAddress(),
          chainId: 84532, requiresExternalWalletSignature: true, contractConfigured: isContractConfigured(),
          preview: { positionUsdc: Number(body.positionUsdc ?? body.stakeUsdc ?? 0) } };
  }
  await audit(request, "accepted");
  await saveIdempotentResponse(agent.agentId, action, request.idempotencyKey, result);
  return json(result);
}
