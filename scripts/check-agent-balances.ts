/**
 * Quick read of every Mimir agent wallet on BOT Chain Testnet.
 * Shows native BOT (gas) and USDT (stake) balances.
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/check-agent-balances.ts
 */
import { privateKeyToAccount } from "viem/accounts";
import { createBotchainPublicClient, weiToBot, getExplorerAddressUrl } from "../lib/botchain";
import { COUNCIL_PERSONAS, personaPrivateKeyEnv, personaAddressEnv } from "../agents/council/personas";
import { ERC20_ABI, USDT_ADDRESS, unitsToUsdt } from "../lib/usdt";

function addressFromKeyEnv(keyEnv: string): `0x${string}` | null {
  const key = process.env[keyEnv]?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return privateKeyToAccount(key as `0x${string}`).address;
}

async function main(): Promise<void> {
  const client = createBotchainPublicClient();

  const rows: Array<{ label: string; address: `0x${string}` }> = [];
  const oracle = addressFromKeyEnv("ORACLE_PRIVATE_KEY") ?? (process.env.ORACLE_ADDRESS as `0x${string}` | undefined);
  const creator = addressFromKeyEnv("CREATOR_PRIVATE_KEY") ?? (process.env.CREATOR_ADDRESS as `0x${string}` | undefined);
  if (oracle) rows.push({ label: "oracle", address: oracle });
  if (creator) rows.push({ label: "market-creator", address: creator });
  for (const persona of COUNCIL_PERSONAS) {
    const addr =
      addressFromKeyEnv(personaPrivateKeyEnv(persona)) ??
      (process.env[personaAddressEnv(persona)] as `0x${string}` | undefined);
    if (addr) rows.push({ label: `council:${persona.slug}`, address: addr });
  }

  if (rows.length === 0) {
    console.error("No agent wallets configured — run: npx tsx scripts/create-agent-wallets.ts --write");
    process.exit(1);
  }

  console.log("BOT Chain Testnet balances (gas BOT + stake USDT):\n");
  console.log(`USDT token: ${USDT_ADDRESS}\n`);
  for (const row of rows) {
    const bot = await client.getBalance({ address: row.address });
    const usdt = (await client.readContract({
      address: USDT_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [row.address],
    })) as bigint;
    console.log(
      `  ${row.label.padEnd(26)} ${weiToBot(bot).toFixed(4).padStart(8)} BOT  ${unitsToUsdt(usdt).toFixed(2).padStart(10)} USDT  ${row.address}`
    );
  }
  console.log(`\n${getExplorerAddressUrl(rows[0].address)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
