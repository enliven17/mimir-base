/**
 * BOT Chain configuration
 * Chain ID: 968 (0x3c8) — BOT Chain Testnet
 * Native currency: BOT (18 decimals) — gas + agent micropayments
 * Market stakes: USDT ERC-20 (6 decimals) — see lib/usdt.ts
 * RPC: https://rpc.bohr.life — Explorer: https://scan.bohr.life
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Pulled out so the rest of the file can read the URL without optional-chain noise.
export const BOTCHAIN_EXPLORER_URL = "https://scan.bohr.life";

// ── Chain definition ──────────────────────────────────────────────────────────
export const botchainTestnet: Chain = {
  id: 968,
  name: "BOT Chain Testnet",
  nativeCurrency: {
    name: "BOT",
    symbol: "BOT",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.bohr.life"],
    },
  },
  blockExplorers: {
    default: {
      name: "BOTScan",
      url: BOTCHAIN_EXPLORER_URL,
    },
  },
  testnet: true,
};

// ── RPC endpoint ──────────────────────────────────────────────────────────────
export function getBotchainRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BOTCHAIN_RPC ||
    (typeof window === "undefined" ? process.env.BOTCHAIN_RPC : undefined) ||
    botchainTestnet.rpcUrls.default.http[0]
  );
}

export function getContractAddress(): `0x${string}` {
  const addr =
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
    "0x0000000000000000000000000000000000000000";
  return addr as `0x${string}`;
}

/** False when NEXT_PUBLIC_CONTRACT_ADDRESS is unset / zero — skip chain reads. */
export function isContractConfigured(): boolean {
  const addr = getContractAddress().toLowerCase();
  return addr !== "0x0000000000000000000000000000000000000000";
}

// Log scans start from the contract's deploy block and paginate in fixed chunks.
export const BOTCHAIN_LOG_CHUNK = 9_999n;

export function getDeployBlock(): bigint {
  const raw = process.env.NEXT_PUBLIC_DEPLOY_BLOCK;
  if (raw && raw.trim().length > 0) {
    try { return BigInt(raw); } catch { /* fall through */ }
  }
  return 0n;
}

/**
 * How many `eth_getLogs` chunks to keep in flight. A serial scan from the deploy
 * block is hundreds of round trips; parallel workers keep cold page renders in
 * the seconds range without tripping per-client rate limits.
 */
export const BOTCHAIN_LOG_CONCURRENCY = (() => {
  const raw = Number(
    (typeof process !== "undefined" && process.env?.BOTCHAIN_LOG_CONCURRENCY) || "24"
  );
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 24;
})();

const PRUNED_HISTORY = /pruned history/i;

function isPrunedError(error: unknown): boolean {
  return error instanceof Error && PRUNED_HISTORY.test(error.message);
}


/**
 * If the RPC serves only a trailing window of history and the deploy block fell
 * out of it, blindly scanning from deploy wastes hundreds of failing round trips.
 * The boundary only moves forward, so bisect for it once and reuse per instance.
 */
let earliestReadableIndex: { deployBlock: bigint; index: number; at: number } | null = null;
const EARLIEST_TTL_MS = 10 * 60 * 1000;

async function findFirstReadableRange(
  client: PublicClient,
  params: Omit<Parameters<PublicClient["getLogs"]>[0], "fromBlock" | "toBlock">,
  ranges: Array<{ from: bigint; to: bigint }>,
  deployBlock: bigint,
): Promise<number> {
  const cached = earliestReadableIndex;
  if (
    cached &&
    cached.deployBlock === deployBlock &&
    Date.now() - cached.at < EARLIEST_TTL_MS &&
    cached.index < ranges.length
  ) {
    return cached.index;
  }

  // One block is enough to tell "pruned" from "readable", and keeps the probe cheap.
  const readable = async (index: number): Promise<boolean> => {
    const { from } = ranges[index];
    try {
      await client.getLogs({ ...(params as any), fromBlock: from, toBlock: from });
      return true;
    } catch (error) {
      if (isPrunedError(error)) return false;
      throw error;
    }
  };

  let lo = 0;
  let hi = ranges.length - 1;
  if (await readable(lo)) {
    earliestReadableIndex = { deployBlock, index: 0, at: Date.now() };
    return 0;
  }
  // Lower bound: smallest index whose start block the RPC still serves. A boundary
  // falling mid-range costs us that range's first blocks, which is noise next to the
  // history already pruned away.
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (await readable(mid)) hi = mid;
    else lo = mid + 1;
  }

  earliestReadableIndex = { deployBlock, index: lo, at: Date.now() };
  return lo;
}

export async function paginatedGetLogs(
  client: PublicClient,
  params: Omit<Parameters<PublicClient["getLogs"]>[0], "fromBlock" | "toBlock">,
  fromBlock: bigint,
  toBlock?: bigint,
): Promise<any[]> {
  const end = toBlock ?? (await client.getBlockNumber());

  const allRanges: Array<{ from: bigint; to: bigint }> = [];
  for (let start = fromBlock; start <= end; ) {
    const stop = start + BOTCHAIN_LOG_CHUNK > end ? end : start + BOTCHAIN_LOG_CHUNK;
    allRanges.push({ from: start, to: stop });
    start = stop + 1n;
  }

  const firstReadable =
    allRanges.length > 1
      ? await findFirstReadableRange(client, params, allRanges, fromBlock)
      : 0;
  const ranges = allRanges.slice(firstReadable);
  if (firstReadable > 0) {
    console.warn(
      `[botchain] getLogs: skipping ${firstReadable}/${allRanges.length} pruned block ranges below ${ranges[0]?.from}.`
    );
  }

  // Results stay in range order so callers still see logs oldest-first.
  const pages: any[][] = new Array(ranges.length);
  let next = 0;
  let unavailable = 0;
  let lastError: unknown = null;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= ranges.length) return;
      const { from, to } = ranges[index];
      try {
        pages[index] = await client.getLogs({
          ...(params as any),
          fromBlock: from,
          toBlock: to,
        });
      } catch (error) {
        // If the RPC prunes history, ranges near the deploy block are simply gone.
        // One dead chunk must not reject the whole scan — drop the unreadable
        // range and keep the rest.
        pages[index] = [];
        unavailable++;
        lastError = error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BOTCHAIN_LOG_CONCURRENCY, ranges.length) }, worker)
  );

  // Every range failing means the RPC is broken, not pruned: surface that instead
  // of pretending the contract has no history.
  if (unavailable === ranges.length && ranges.length > 0) {
    throw lastError instanceof Error
      ? lastError
      : new Error("eth_getLogs failed for every block range");
  }
  if (unavailable > 0) {
    console.warn(
      `[botchain] getLogs: ${unavailable}/${ranges.length} block ranges unavailable (pruned history); serving the readable remainder.`
    );
  }

  return pages.flat();
}

export function getExplorerTxUrl(txHash: string): string {
  return `${BOTCHAIN_EXPLORER_URL}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string): string {
  return `${BOTCHAIN_EXPLORER_URL}/address/${address}`;
}


// ── viem clients ──────────────────────────────────────────────────────────────
// viem's JSON-RPC batch transport bundles all eth_call requests that fire within
// `wait` ms into one POST body, which drops the request count by ~100x and keeps
// bursty feed renders under the provider's per-client throttle. retryCount and
// retryDelay smooth over the occasional transient 429. Batch size is capped at
// 10 calls per POST — conservative on purpose; a provider rejecting oversized
// batches would silently stall the whole VS index.
export const RPC_BATCH_SIZE = (() => {
  const raw = Number(
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_RPC_BATCH_SIZE) || "10"
  );
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
})();

const BOTCHAIN_HTTP_OPTS = {
  batch: { batchSize: RPC_BATCH_SIZE, wait: 16 },
  // Keep per-request budgets tight: callers (readClaimRaw, agent poll loops)
  // have their own outer retries, and a hanging RPC must fail fast enough for
  // serverless routes to fall back to cached data instead of 504ing.
  retryCount: 2,
  retryDelay: 300,
  timeout: 10_000,
};

export function createBotchainPublicClient(): PublicClient {
  return createPublicClient({
    chain: botchainTestnet,
    transport: http(getBotchainRpcUrl(), BOTCHAIN_HTTP_OPTS),
  }) as PublicClient;
}

export function createBotchainHttpTransport() {
  return http(getBotchainRpcUrl(), BOTCHAIN_HTTP_OPTS);
}

export function createBotchainWalletClient(provider: unknown): WalletClient {
  return createWalletClient({
    chain: botchainTestnet,
    transport: custom(provider as any),
  });
}

export function createBotchainWalletClientWithKey(privateKey: string): WalletClient {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return createWalletClient({
    chain: botchainTestnet,
    account,
    transport: http(getBotchainRpcUrl(), BOTCHAIN_HTTP_OPTS),
  });
}

// ── MetaMask chain-switch helper ──────────────────────────────────────────────
export async function ensureBotChain(ethereum: {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}): Promise<void> {
  const chainIdHex = `0x${botchainTestnet.id.toString(16)}`;
  const currentChainId = (await ethereum.request({ method: "eth_chainId" })) as string;

  if (currentChainId === chainIdHex) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err: any) {
    if (err?.code !== 4902) throw err;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: botchainTestnet.name,
          rpcUrls: botchainTestnet.rpcUrls.default.http,
          nativeCurrency: botchainTestnet.nativeCurrency,
          blockExplorerUrls: [BOTCHAIN_EXPLORER_URL],
        },
      ],
    });
  }
}

// ── Unit helpers ──────────────────────────────────────────────────────────────
// BOT: 18 decimals at EVM level (like ETH on Ethereum)
// 1 BOT = 1_000_000_000_000_000_000 wei
export const BOT_DECIMALS = 18;
export const BOT_UNIT = BigInt(10 ** BOT_DECIMALS); // 1_000_000_000_000_000_000n

export function botToWei(bot: number): bigint {
  if (!Number.isFinite(bot) || bot < 0) throw new Error("Invalid BOT amount");
  // Support up to 6 significant decimal places
  return BigInt(Math.round(bot * 1_000_000)) * BigInt(10 ** 12);
}

export function weiToBot(micro: bigint | number): number {
  return Number(BigInt(micro) / BigInt(10 ** 12)) / 1_000_000;
}

export function formatBot(micro: bigint | number, decimals = 2): string {
  return weiToBot(micro).toFixed(decimals) + " BOT";
}
