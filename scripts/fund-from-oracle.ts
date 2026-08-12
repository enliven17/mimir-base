/**
 * One-shot: fund all other agent wallets from ORACLE_PRIVATE_KEY in .env.local.
 * Strips inline comments from env values.
 *
 *   npx tsx --env-file=.env.local scripts/fund-from-oracle.ts
 */
import { formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBasePublicClient,
  createBaseWalletClientWithKey,
  weiToEth,
  getExplorerTxUrl,
  baseSepolia,
} from "../lib/base";
import {
  listCouncilPersonas,
  personaPrivateKeyEnv,
} from "../agents/council/personas";
import { ERC20_ABI, USDC_ADDRESS, usdcToUnits, unitsToUsdc } from "../lib/usdc";

function cleanEnv(name: string): string {
  const raw = process.env[name] ?? "";
  return raw.split(/\s+#/)[0].trim();
}

const GAS_ETH = parseEther(process.env.FUND_GAS_ETH ?? "0.5");
const USDC_CREATOR = usdcToUnits(Number(process.env.FUND_AMOUNT_USDC ?? "50"));
const USDC_COUNCIL = usdcToUnits(Number(process.env.FUND_COUNCIL_AMOUNT_USDC ?? "30"));

async function main() {
  const funderKey = cleanEnv("ORACLE_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(funderKey)) {
    throw new Error("ORACLE_PRIVATE_KEY missing or invalid in .env.local");
  }

  // Make sure agent loaders see clean keys
  process.env.ORACLE_PRIVATE_KEY = funderKey;
  for (const name of [
    "CREATOR_PRIVATE_KEY",
    ...listCouncilPersonas().map((p) => personaPrivateKeyEnv(p)),
  ]) {
    const c = cleanEnv(name);
    if (c) process.env[name] = c;
  }

  const publicClient = createBasePublicClient();
  const funder = privateKeyToAccount(funderKey as `0x${string}`);
  const wallet = createBaseWalletClientWithKey(funderKey);

  const targets: Array<{ label: string; address: `0x${string}`; gas: bigint; usdc: bigint }> = [];

  const add = (label: string, keyEnv: string, usdc: bigint) => {
    const key = process.env[keyEnv]?.trim() ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.warn(`  · skip ${label} — ${keyEnv} not set`);
      return;
    }
    const address = privateKeyToAccount(key as `0x${string}`).address;
    // Don't send gas/USDC to funder itself
    if (address.toLowerCase() === funder.address.toLowerCase()) {
      console.log(`  · ${label.padEnd(24)} is funder — skip self-transfer`);
      return;
    }
    targets.push({ label, address, gas: GAS_ETH, usdc });
  };

  add("market-creator", "CREATOR_PRIVATE_KEY", USDC_CREATOR);
  for (const persona of listCouncilPersonas()) {
    add(`council:${persona.slug}`, personaPrivateKeyEnv(persona), USDC_COUNCIL);
  }

  const funderEth = await publicClient.getBalance({ address: funder.address });
  const funderUsdc = (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [funder.address],
  })) as bigint;

  console.log(`Funder (oracle): ${funder.address}`);
  console.log(`  ETH  : ${weiToEth(funderEth).toFixed(4)}`);
  console.log(`  USDC : ${unitsToUsdc(funderUsdc).toFixed(2)}`);
  console.log(`Targets: ${targets.length}`);
  console.log(`Per target gas: ${formatEther(GAS_ETH)} ETH`);
  console.log(`Creator USDC: ${unitsToUsdc(USDC_CREATOR)}`);
  console.log(`Council USDC: ${unitsToUsdc(USDC_COUNCIL)}\n`);

  for (const t of targets) {
    // Gas
    const ethBal = await publicClient.getBalance({ address: t.address });
    if (ethBal < t.gas) {
      const hash = await wallet.sendTransaction({
        account: funder,
        to: t.address,
        value: t.gas,
        chain: baseSepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✓ ${t.label.padEnd(24)} +${formatEther(t.gas)} ETH  ${getExplorerTxUrl(hash)}`);
    } else {
      console.log(`  · ${t.label.padEnd(24)} gas ok (${weiToEth(ethBal).toFixed(4)} ETH)`);
    }

    // USDC
    const usdcBal = (await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [t.address],
    })) as bigint;
    if (usdcBal < t.usdc) {
      const need = t.usdc - usdcBal;
      const hash = await wallet.writeContract({
        account: funder,
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [t.address, need],
        chain: baseSepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✓ ${t.label.padEnd(24)} +${unitsToUsdc(need).toFixed(2)} USDC  ${getExplorerTxUrl(hash)}`);
    } else {
      console.log(`  · ${t.label.padEnd(24)} USDC ok (${unitsToUsdc(usdcBal).toFixed(2)})`);
    }
  }

  console.log("\nDone. Run: npm run agents:balances");
}

main().catch((err) => {
  console.error("fund-from-oracle failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
