/**
 * Local private-key wallets for the Mimir worker agents (oracle, market-creator,
 * council personas).
 *
 * Each agent owns a plain EOA whose key lives only in the worker process env —
 * the web server never sees private keys, it only knows the public addresses
 * (COUNCIL_<SLUG>_ADDRESS etc.) for payment routing and display.
 *
 * Env contract (workers only):
 *   ORACLE_PRIVATE_KEY=0x...                  → oracle agent
 *   CREATOR_PRIVATE_KEY=0x...                 → market-creator agent
 *   COUNCIL_<SLUG>_PRIVATE_KEY=0x...          → each council persona
 *
 * Generate all twelve in one pass:  npm run agents:create-wallets
 * Fund them from one master key:    npm run agents:fund
 */

import { maxUint256, parseEther, type WalletClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  createBotchainWalletClientWithKey,
  createBotchainPublicClient,
  getContractAddress,
  botchainTestnet,
} from "./botchain";
import { ERC20_ABI, USDT_ADDRESS, usdtToUnits } from "./usdt";

export interface AgentWallet {
  account: PrivateKeyAccount;
  client: WalletClient;
  address: `0x${string}`;
}

function normalizeKey(raw: string | undefined, envVar: string): `0x${string}` {
  const key = raw?.trim();
  if (!key) throw new Error(`${envVar} env var is required`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`${envVar} must be a 0x-prefixed 32-byte hex private key`);
  }
  return key as `0x${string}`;
}

/** Build a wallet from an explicit private key env var. */
export function loadAgentWallet(envVar: string): AgentWallet {
  const key = normalizeKey(process.env[envVar], envVar);
  const account = privateKeyToAccount(key);
  return {
    account,
    client: createBotchainWalletClientWithKey(key),
    address: account.address,
  };
}

export function getOracleWallet(): AgentWallet {
  return loadAgentWallet("ORACLE_PRIVATE_KEY");
}

export function getCreatorWallet(): AgentWallet {
  return loadAgentWallet("CREATOR_PRIVATE_KEY");
}

export function councilEnvSlug(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}

export function councilPrivateKeyEnv(slug: string): string {
  return `COUNCIL_${councilEnvSlug(slug)}_PRIVATE_KEY`;
}

export function councilAddressEnv(slug: string): string {
  return `COUNCIL_${councilEnvSlug(slug)}_ADDRESS`;
}

export function getCouncilWallet(slug: string): AgentWallet {
  return loadAgentWallet(councilPrivateKeyEnv(slug));
}

/** Public address of a persona without touching its key (web-server safe). */
export function getCouncilAddress(slug: string): `0x${string}` | undefined {
  const addr = process.env[councilAddressEnv(slug)]?.trim();
  return addr?.startsWith("0x") ? (addr as `0x${string}`) : undefined;
}

// ── On-chain writes ───────────────────────────────────────────────────────────

export interface AgentWriteArgs {
  wallet: AgentWallet;
  contractAddress: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  /**
   * Decimal USDT stake that must be approved for the Mimir contract before the
   * write (createClaim / challengeClaim / createRematch). NOT native BOT.
   */
  amountUsdt?: string;
  /** @deprecated use amountUsdt */
  amountBot?: string;
}

async function ensureAgentUsdtAllowance(
  wallet: AgentWallet,
  spender: `0x${string}`,
  amountUnits: bigint
): Promise<void> {
  if (amountUnits <= 0n) return;
  const client = createBotchainPublicClient();
  const current = (await client.readContract({
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [wallet.address, spender],
  })) as bigint;
  if (current >= amountUnits) return;

  const hash = await wallet.client.writeContract({
    account: wallet.account,
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, maxUint256],
    chain: botchainTestnet,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`USDT approve reverted (tx ${hash})`);
  }
}

/**
 * Submit a contract write from an agent wallet and wait for the receipt.
 * When amountUsdt is set, ensures USDT allowance to the Mimir contract first.
 * Returns the tx hash; throws when the transaction reverts.
 */
export async function agentContractWrite(args: AgentWriteArgs): Promise<`0x${string}`> {
  const stakeDec = args.amountUsdt ?? args.amountBot;
  if (stakeDec) {
    const units = usdtToUnits(Number(stakeDec));
    await ensureAgentUsdtAllowance(args.wallet, args.contractAddress, units);
  }

  const hash = await args.wallet.client.writeContract({
    account: args.wallet.account,
    address: args.contractAddress,
    abi: args.abi as never,
    functionName: args.functionName,
    args: (args.args ?? []) as never,
    chain: null,
  });
  const receipt = await createBotchainPublicClient().waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`${args.functionName} reverted on-chain (tx ${hash})`);
  }
  return hash;
}

/** Transfer ERC-20 USDT from an agent wallet. */
export async function transferUsdt(args: {
  wallet: AgentWallet;
  to: `0x${string}`;
  /** Decimal USDT amount, e.g. "5". */
  amountUsdt: string;
}): Promise<`0x${string}`> {
  const hash = await args.wallet.client.writeContract({
    account: args.wallet.account,
    address: USDT_ADDRESS,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [args.to, usdtToUnits(Number(args.amountUsdt))],
    chain: botchainTestnet,
  });
  const receipt = await createBotchainPublicClient().waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`USDT transfer reverted on-chain (tx ${hash})`);
  }
  return hash;
}

/**
 * Transfer native BOT from an agent wallet to an arbitrary destination.
 * Returns the tx hash once confirmed.
 */
export async function transferBot(args: {
  wallet: AgentWallet;
  to: `0x${string}`;
  /** Decimal BOT amount, e.g. "0.01". */
  amountBot: string;
}): Promise<`0x${string}`> {
  const hash = await args.wallet.client.sendTransaction({
    account: args.wallet.account,
    to: args.to,
    value: parseEther(args.amountBot),
    chain: null,
  });
  const receipt = await createBotchainPublicClient().waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`BOT transfer reverted on-chain (tx ${hash})`);
  }
  return hash;
}
