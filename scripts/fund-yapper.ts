import { parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBotchainPublicClient,
  createBotchainWalletClientWithKey,
  botchainTestnet,
  getExplorerTxUrl,
  weiToBot,
} from "../lib/botchain";
import { ERC20_ABI, USDT_ADDRESS, usdtToUnits, unitsToUsdt } from "../lib/usdt";

const clean = (n: string) => (process.env[n] || "").split(/\s+#/)[0].trim();

async function main() {
  const funderKey = clean("ORACLE_PRIVATE_KEY");
  const funder = privateKeyToAccount(funderKey as `0x${string}`);
  const wallet = createBotchainWalletClientWithKey(funderKey);
  const client = createBotchainPublicClient();
  const to = "0xF1c89564E4e871088f35152f32991eb7EbCA4E8b" as const;

  const bot = await client.getBalance({ address: funder.address });
  const usdt = (await client.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [funder.address],
  })) as bigint;
  console.log(`oracle BOT ${weiToBot(bot).toFixed(4)}  USDT ${unitsToUsdt(usdt).toFixed(2)}`);

  const leave = parseEther("0.05");
  let sendBot = 0n;
  if (bot > leave + parseEther("0.2")) sendBot = parseEther("0.3");
  else if (bot > leave + parseEther("0.1")) sendBot = bot - leave;

  if (sendBot > 0n) {
    const h = await wallet.sendTransaction({
      account: funder,
      to,
      value: sendBot,
      chain: botchainTestnet,
    });
    await client.waitForTransactionReceipt({ hash: h });
    console.log(`yapper +${weiToBot(sendBot).toFixed(4)} BOT  ${getExplorerTxUrl(h)}`);
  } else {
    console.log("not enough BOT left for yapper gas — fund oracle gas first");
  }

  const needUsdt = usdtToUnits(30);
  const yUsdt = (await client.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [to],
  })) as bigint;
  if (yUsdt < needUsdt) {
    const h2 = await wallet.writeContract({
      account: funder,
      address: USDT_ADDRESS,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [to, needUsdt - yUsdt],
      chain: botchainTestnet,
    });
    await client.waitForTransactionReceipt({ hash: h2 });
    console.log(`yapper +${unitsToUsdt(needUsdt - yUsdt).toFixed(2)} USDT  ${getExplorerTxUrl(h2)}`);
  } else {
    console.log(`yapper USDT ok (${unitsToUsdt(yUsdt).toFixed(2)})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
