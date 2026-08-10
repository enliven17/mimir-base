/**
 * Move native BOT (gas) from market-creator → oracle.
 * Optional: also top up low-gas council wallets.
 *
 *   npx tsx --env-file=.env.local scripts/topup-oracle-from-creator.ts
 */
import { parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBotchainPublicClient,
  createBotchainWalletClientWithKey,
  botchainTestnet,
  getExplorerTxUrl,
  weiToBot,
} from "../lib/botchain";

const clean = (n: string) => (process.env[n] || "").split(/\s+#/)[0].trim();

async function main() {
  const creatorKey = clean("CREATOR_PRIVATE_KEY");
  const oracleKey = clean("ORACLE_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(creatorKey)) throw new Error("CREATOR_PRIVATE_KEY missing");
  if (!/^0x[0-9a-fA-F]{64}$/.test(oracleKey)) throw new Error("ORACLE_PRIVATE_KEY missing");

  const creator = privateKeyToAccount(creatorKey as `0x${string}`);
  const oracle = privateKeyToAccount(oracleKey as `0x${string}`);
  const wallet = createBotchainWalletClientWithKey(creatorKey);
  const client = createBotchainPublicClient();

  const creatorBot = await client.getBalance({ address: creator.address });
  const oracleBot = await client.getBalance({ address: oracle.address });
  console.log(`creator ${creator.address}  ${weiToBot(creatorBot).toFixed(4)} BOT`);
  console.log(`oracle  ${oracle.address}  ${weiToBot(oracleBot).toFixed(4)} BOT`);

  // Leave ~0.3 BOT on creator for its own gas; send rest to oracle (cap 8 BOT)
  const leave = parseEther("0.3");
  const maxSend = parseEther("8");
  let send = creatorBot > leave ? creatorBot - leave : 0n;
  if (send > maxSend) send = maxSend;

  if (send <= parseEther("0.05")) {
    console.log("Nothing meaningful to send (creator low).");
    return;
  }

  const hash = await wallet.sendTransaction({
    account: creator,
    to: oracle.address,
    value: send,
    chain: botchainTestnet,
  });
  await client.waitForTransactionReceipt({ hash });
  console.log(`✓ sent ${weiToBot(send).toFixed(4)} BOT → oracle  ${getExplorerTxUrl(hash)}`);

  const afterC = await client.getBalance({ address: creator.address });
  const afterO = await client.getBalance({ address: oracle.address });
  console.log(`creator now ${weiToBot(afterC).toFixed(4)} BOT`);
  console.log(`oracle  now ${weiToBot(afterO).toFixed(4)} BOT`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
