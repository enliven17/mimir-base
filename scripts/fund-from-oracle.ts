/**
 * One-shot: fund all other agent wallets from ORACLE_PRIVATE_KEY in .env.local.
 * Strips inline comments from env values.
 *
 *   npx tsx --env-file=.env.local scripts/fund-from-oracle.ts
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

function cleanEnv(name: string): string {
  const raw = process.env[name] ?? "";
  return raw.split(/\s+#/)[0].trim();
}

const GAS_BOT = parseEther(process.env.FUND_GAS_BOT ?? "0.5");
const USDT_CREATOR = usdtToUnits(Number(process.env.FUND_AMOUNT_USDT ?? "50"));
const USDT_COUNCIL = usdtToUnits(Number(process.env.FUND_COUNCIL_AMOUNT_USDT ?? "30"));

async function main() {
  const funderKey = cleanEnv("ORACLE_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(funderKey)) {
    throw new Error("ORACLE_PRIVATE_KEY missing or invalid in .env.local");
  }

  // Make sure agent loaders see clean keys
  process.env.ORACLE_PRIVATE_KEY = funderKey;
  for (const name of [
    "CREATOR_PRIVATE_KEY",
    ...COUNCIL_PERSONAS.map((p) => personaPrivateKeyEnv(p)),
  ]) {
    const c = cleanEnv(name);
    if (c) process.env[name] = c;
  }

  const publicClient = createBotchainPublicClient();
  const funder = privateKeyToAccount(funderKey as `0x${string}`);
  const wallet = createBotchainWalletClientWithKey(funderKey);

  const targets: Array<{ label: string; address: `0x${string}`; gas: bigint; usdt: bigint }> = [];

  const add = (label: string, keyEnv: string, usdt: bigint) => {
    const key = process.env[keyEnv]?.trim() ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.warn(`  · skip ${label} — ${keyEnv} not set`);
      return;
    }
    const address = privateKeyToAccount(key as `0x${string}`).address;
    // Don't send gas/USDT to funder itself
    if (address.toLowerCase() === funder.address.toLowerCase()) {
      console.log(`  · ${label.padEnd(24)} is funder — skip self-transfer`);
      return;
    }
    targets.push({ label, address, gas: GAS_BOT, usdt });
  };

  add("market-creator", "CREATOR_PRIVATE_KEY", USDT_CREATOR);
  for (const persona of COUNCIL_PERSONAS) {
    add(`council:${persona.slug}`, personaPrivateKeyEnv(persona), USDT_COUNCIL);
  }

  const funderBot = await publicClient.getBalance({ address: funder.address });
  const funderUsdt = (await publicClient.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [funder.address],
  })) as bigint;

  console.log(`Funder (oracle): ${funder.address}`);
  console.log(`  BOT  : ${weiToBot(funderBot).toFixed(4)}`);
  console.log(`  USDT : ${unitsToUsdt(funderUsdt).toFixed(2)}`);
  console.log(`Targets: ${targets.length}`);
  console.log(`Per target gas: ${formatEther(GAS_BOT)} BOT`);
  console.log(`Creator USDT: ${unitsToUsdt(USDT_CREATOR)}`);
  console.log(`Council USDT: ${unitsToUsdt(USDT_COUNCIL)}\n`);

  for (const t of targets) {
    // Gas
    const botBal = await publicClient.getBalance({ address: t.address });
    if (botBal < t.gas) {
      const hash = await wallet.sendTransaction({
        account: funder,
        to: t.address,
        value: t.gas,
        chain: botchainTestnet,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✓ ${t.label.padEnd(24)} +${formatEther(t.gas)} BOT  ${getExplorerTxUrl(hash)}`);
    } else {
      console.log(`  · ${t.label.padEnd(24)} gas ok (${weiToBot(botBal).toFixed(4)} BOT)`);
    }

    // USDT
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
      console.log(`  ✓ ${t.label.padEnd(24)} +${unitsToUsdt(need).toFixed(2)} USDT  ${getExplorerTxUrl(hash)}`);
    } else {
      console.log(`  · ${t.label.padEnd(24)} USDT ok (${unitsToUsdt(usdtBal).toFixed(2)})`);
    }
  }

  console.log("\nDone. Run: npm run agents:balances");
}

main().catch((err) => {
  console.error("fund-from-oracle failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
