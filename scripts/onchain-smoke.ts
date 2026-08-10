/**
 * Post-deploy on-chain smoke (USDT stakes):
 *   1. Read oracle / usdt / claimCount
 *   2. Creator createClaim (2 USDT, short deadline)
 *   3. Oracle challengeClaim (2 USDT)
 *   4. Read claim state
 *
 *   npx tsx --env-file=.env.local scripts/onchain-smoke.ts
 */
import {
  createBotchainPublicClient,
  getContractAddress,
  getExplorerTxUrl,
  weiToBot,
} from "../lib/botchain";
import { agentContractWrite, getCreatorWallet, getOracleWallet } from "../lib/agent-wallets";
import { MIMIR_ABI, STATE } from "../lib/mimir-abi";
import { ERC20_ABI, USDT_ADDRESS, usdtToUnits, unitsToUsdt } from "../lib/usdt";
import { fetchDecodedClaim } from "../lib/claim-codec";

function cleanKeys() {
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && v.includes("#")) {
      process.env[k] = v.split(/\s+#/)[0].trim();
    }
  }
}

async function main() {
  cleanKeys();
  const client = createBotchainPublicClient();
  const contract = getContractAddress();
  const creator = getCreatorWallet();
  const oracle = getOracleWallet();

  console.log("── On-chain smoke ──");
  console.log(`Contract: ${contract}`);
  console.log(`USDT    : ${USDT_ADDRESS}`);
  console.log(`Creator : ${creator.address}`);
  console.log(`Oracle  : ${oracle.address}`);

  const [onOracle, onUsdt, claimCount] = await Promise.all([
    client.readContract({ address: contract, abi: MIMIR_ABI, functionName: "oracle" }) as Promise<`0x${string}`>,
    client.readContract({ address: contract, abi: MIMIR_ABI, functionName: "usdt" }) as Promise<`0x${string}`>,
    client.readContract({ address: contract, abi: MIMIR_ABI, functionName: "claimCount" }) as Promise<bigint>,
  ]);

  console.log(`\n[1] config`);
  console.log(`  oracle()     = ${onOracle}`);
  console.log(`  usdt()       = ${onUsdt}`);
  console.log(`  claimCount() = ${claimCount}`);

  if (onOracle.toLowerCase() !== oracle.address.toLowerCase()) {
    throw new Error(`oracle mismatch: contract=${onOracle} expected=${oracle.address}`);
  }
  if (onUsdt.toLowerCase() !== USDT_ADDRESS.toLowerCase()) {
    throw new Error(`usdt mismatch: contract=${onUsdt} expected=${USDT_ADDRESS}`);
  }
  console.log("  ✓ oracle + usdt match");

  const stake = usdtToUnits(2);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log(`\n[2] createClaim (2 USDT)…`);
  const createTx = await agentContractWrite({
    wallet: creator,
    contractAddress: contract,
    abi: MIMIR_ABI,
    functionName: "createClaim",
    args: [
      "Onchain smoke — will this claim be challengeable?",
      "Yes",
      "No",
      "https://example.com/smoke",
      deadline,
      stake,
      "custom",
      0n,
      "binary",
      "pool",
      0n,
      "",
      "Smoke test only — not for real settlement",
      100n,
      false,
      "",
    ],
    amountUsdt: "2",
  });
  console.log(`  create: ${getExplorerTxUrl(createTx)}`);

  const newCount = (await client.readContract({
    address: contract,
    abi: MIMIR_ABI,
    functionName: "claimCount",
  })) as bigint;
  const claimId = Number(newCount);
  console.log(`  claimId = #${claimId}`);

  console.log(`\n[3] challengeClaim (2 USDT from oracle)…`);
  const challengeTx = await agentContractWrite({
    wallet: oracle,
    contractAddress: contract,
    abi: MIMIR_ABI,
    functionName: "challengeClaim",
    args: [BigInt(claimId), stake, ""],
    amountUsdt: "2",
  });
  console.log(`  challenge: ${getExplorerTxUrl(challengeTx)}`);

  console.log(`\n[4] read claim…`);
  const decoded = await fetchDecodedClaim(client, contract, claimId);
  if (!decoded) throw new Error("claim not found after create");

  console.log(`  state            = ${decoded.state} (expect ACTIVE=${STATE.ACTIVE})`);
  console.log(`  creatorStake     = ${unitsToUsdt(decoded.creatorStake)} USDT`);
  console.log(`  challengerStake  = ${unitsToUsdt(decoded.totalChallengerStake)} USDT`);
  console.log(`  challengerCount  = ${decoded.challengerCount}`);

  if (Number(decoded.state) !== STATE.ACTIVE) {
    throw new Error(`expected ACTIVE, got ${decoded.state}`);
  }
  if (decoded.challengerCount < 1n && Number(decoded.challengerCount) < 1) {
    // challengerCount might be number or bigint depending on decode
  }
  const chCount = Number(decoded.challengerCount);
  if (chCount < 1) throw new Error("expected at least 1 challenger");
  if (unitsToUsdt(decoded.creatorStake) !== 2) {
    throw new Error(`creator stake expected 2 USDT, got ${unitsToUsdt(decoded.creatorStake)}`);
  }
  if (unitsToUsdt(decoded.totalChallengerStake) !== 2) {
    throw new Error(`challenger stake expected 2 USDT, got ${unitsToUsdt(decoded.totalChallengerStake)}`);
  }

  const pot = (await client.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [contract],
  })) as bigint;
  console.log(`  contract USDT bal = ${unitsToUsdt(pot)} (expect 4)`);
  if (unitsToUsdt(pot) < 4) throw new Error("contract should hold 4 USDT pot");

  const creatorBot = await client.getBalance({ address: creator.address });
  const oracleBot = await client.getBalance({ address: oracle.address });
  console.log(`\n  creator gas left: ${weiToBot(creatorBot).toFixed(4)} BOT`);
  console.log(`  oracle  gas left: ${weiToBot(oracleBot).toFixed(4)} BOT`);

  console.log("\n✓ ON-CHAIN SMOKE PASSED");
}

main().catch((err) => {
  console.error("onchain-smoke FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
