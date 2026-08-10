/**
 * Fund the twelve Mimir agent wallets from one master key.
 *
 *   FUNDER_PRIVATE_KEY=0x... npx tsx --env-file=.env.local scripts/fund-agents.ts
 *
 * Sends:
 *   - native BOT for gas (FUND_GAS_BOT, default 1)
 *   - USDT for stakes (FUND_AMOUNT_USDT / FUND_COUNCIL_AMOUNT_USDT, defaults 20 / 10)
 *
 * The funder must hold both tBOT (faucet) and test USDT on BOT Chain Testnet.
 * USDT: 0x75edC9335175Fc0552D51D48439F229c10420fe3
 */

import { formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBotchainPublicClient,
  createBotchainWalletClientWithKey,
  weiToBot,
  getExplorerTxUrl,
  botchainTestnet,
} from "../lib/botchain";
import {
  COUNCIL_PERSONAS,
  personaPrivateKeyEnv,
} from "../agents/council/personas";
import { ERC20_ABI, USDT_ADDRESS, usdtToUnits, unitsToUsdt } from "../lib/usdt";

const GAS_BOT = parseEther(process.env.FUND_GAS_BOT ?? "1");
const USDT_CORE = usdtToUnits(Number(process.env.FUND_AMOUNT_USDT ?? "20"));
const USDT_COUNCIL = usdtToUnits(Number(process.env.FUND_COUNCIL_AMOUNT_USDT ?? "10"));

async function main(): Promise<void> {
  const funderKey = process.env.FUNDER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
  if (!funderKey || !/^0x[0-9a-fA-F]{64}$/.test(funderKey)) {
    console.error("FUNDER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is required — a 0x-prefixed 32-byte hex key.");
    process.exit(1);
  }

  const publicClient = createBotchainPublicClient();
  const funder = privateKeyToAccount(funderKey as `0x${string}`);
  const wallet = createBotchainWalletClientWithKey(funderKey);

  const targets: Array<{
    label: string;
    address: `0x${string}`;
    gas: bigint;
    usdt: bigint;
  }> = [];

  const addTarget = (label: string, keyEnv: string, usdt: bigint) => {
    const key = process.env[keyEnv]?.trim();
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.warn(`  · skip ${label} — ${keyEnv} not set`);
      return;
    }
    targets.push({
      label,
      address: privateKeyToAccount(key as `0x${string}`).address,
      gas: GAS_BOT,
      usdt,
    });
  };

  addTarget("oracle", "ORACLE_PRIVATE_KEY", USDT_CORE);
  addTarget("market-creator", "CREATOR_PRIVATE_KEY", USDT_CORE);
  for (const persona of COUNCIL_PERSONAS) {
    addTarget(`council:${persona.slug}`, personaPrivateKeyEnv(persona), USDT_COUNCIL);
  }

  const funderBot = await publicClient.getBalance({ address: funder.address });
  const funderUsdt = (await publicClient.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [funder.address],
  })) as bigint;

  console.log(`Funder     : ${funder.address}`);
  console.log(`  BOT gas  : ${weiToBot(funderBot).toFixed(4)} BOT`);
  console.log(`  USDT     : ${unitsToUsdt(funderUsdt).toFixed(2)} USDT  (${USDT_ADDRESS})`);
  console.log(`Targets    : ${targets.length} wallets`);
  console.log(`Per core   : ${formatEther(GAS_BOT)} BOT gas + ${unitsToUsdt(USDT_CORE)} USDT`);
  console.log(`Per council: ${formatEther(GAS_BOT)} BOT gas + ${unitsToUsdt(USDT_COUNCIL)} USDT\n`);

  for (const t of targets) {
    // Gas (native BOT)
    const botBal = await publicClient.getBalance({ address: t.address });
    if (botBal < t.gas) {
      const hash = await wallet.sendTransaction({
        account: funder,
        to: t.address,
        value: t.gas,
        chain: botchainTestnet,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✓ ${t.label.padEnd(24)} +${formatEther(t.gas)} BOT gas — ${getExplorerTxUrl(hash)}`);
    } else {
      console.log(`  · ${t.label.padEnd(24)} gas ok (${weiToBot(botBal).toFixed(4)} BOT)`);
    }

    // Stake token (USDT)
    const usdtBal = (await publicClient.readContract({
      address: USDT_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [t.address],
    })) as bigint;
    if (usdtBal < t.usdt) {
      const need = t.usdt - usdtBal;
      const hash = await wallet.writeContract({
        account: funder,
        address: USDT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [t.address, need],
        chain: botchainTestnet,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✓ ${t.label.padEnd(24)} +${unitsToUsdt(need).toFixed(2)} USDT — ${getExplorerTxUrl(hash)}`);
    } else {
      console.log(`  · ${t.label.padEnd(24)} USDT ok (${unitsToUsdt(usdtBal).toFixed(2)} USDT)`);
    }
  }

  console.log("\nDone. Balances: npm run agents:balances");
}

main().catch((err) => {
  console.error("fund-agents failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
