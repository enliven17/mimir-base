/**
 * Paying client for Mimir agents — pay-per-request over HTTP 402, settled with
 * plain native BOT transfers on BOT Chain.
 *
 * Flow when a resource answers 402:
 *   1. Parse the payment requirement from the response body
 *      ({ payment: { payTo, amountWei, ... } }).
 *   2. Send a native BOT transfer to `payTo` from the agent's own wallet.
 *   3. Retry the request with `X-Payment-Tx: <txHash>` — the server verifies
 *      the transfer on-chain and serves the content.
 *
 * Two layers:
 *   1. createPayingFetch() — a fetch wrapper that auto-pays any 402 it hits.
 *   2. fetchWithBudget()  — the agentic layer on top: PROBE the price first,
 *      decide against a budget cap, only THEN pay.
 */

import { createBotchainPublicClient, botchainTestnet } from "./botchain";
import type { AgentWallet } from "./agent-wallets";

export interface PayingWallet {
  /** The agent's on-chain address (payer / from). */
  address: `0x${string}`;
  /** Sends a native BOT transfer; resolves to the confirmed tx hash. */
  sendPayment(to: `0x${string}`, valueWei: bigint): Promise<`0x${string}`>;
}

/** Wrap an agent wallet as a PayingWallet (native BOT transfers). */
export function payingWalletFor(wallet: AgentWallet): PayingWallet {
  return {
    address: wallet.address,
    sendPayment: async (to, valueWei) => {
      const hash = await wallet.client.sendTransaction({
        account: wallet.account,
        to,
        value: valueWei,
        chain: null,
      });
      await createBotchainPublicClient().waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

/** The 402 body's payment requirement (server: lib/paid-server.ts). */
export interface PaymentRequirement {
  scheme?: string;
  chainId?: number;
  currency?: string;
  amount?: string;
  amountWei?: string;
  payTo?: `0x${string}`;
  resource?: string;
  description?: string;
}

export interface PaidFetchResult {
  response: Response;
  /** Null when the resource was free (no 402). */
  payment: {
    priceWei: bigint;
    txHash: `0x${string}`;
  } | null;
}

export class PaymentBudgetExceeded extends Error {
  constructor(
    readonly priceWei: bigint,
    readonly capWei: bigint,
  ) {
    super(`payment price ${priceWei} wei exceeds budget cap ${capWei}`);
    this.name = "PaymentBudgetExceeded";
  }
}

function parseRequirement(body: unknown): PaymentRequirement | null {
  if (!body || typeof body !== "object") return null;
  const payment = (body as { payment?: unknown }).payment;
  if (!payment || typeof payment !== "object") return null;
  const p = payment as PaymentRequirement;
  if (!p.payTo || !p.amountWei) return null;
  return p;
}

async function payAndRetry(
  url: string,
  wallet: PayingWallet,
  requirement: PaymentRequirement,
  init?: RequestInit,
): Promise<{ response: Response; txHash: `0x${string}`; priceWei: bigint }> {
  const priceWei = BigInt(requirement.amountWei!);
  const txHash = await wallet.sendPayment(requirement.payTo!, priceWei);

  const headers = new Headers(init?.headers);
  headers.set("x-payment-tx", txHash);
  headers.set("x-payment-from", wallet.address);
  const response = await fetch(url, { ...init, headers });
  return { response, txHash, priceWei };
}

/**
 * A fetch that automatically pays any 402 it encounters via a native BOT
 * transfer, then retries with the payment proof. No budget guard — use
 * fetchWithBudget for the agentic, capped path.
 */
export function createPayingFetch(wallet: PayingWallet): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const probe = await fetch(input, init);
    if (probe.status !== 402) return probe;

    let requirement: PaymentRequirement | null = null;
    try {
      requirement = parseRequirement(await probe.clone().json());
    } catch {
      requirement = null;
    }
    if (!requirement) return probe;
    if (requirement.chainId && requirement.chainId !== botchainTestnet.id) {
      throw new Error(`402 payment targets unsupported chain ${requirement.chainId}`);
    }

    const paid = await payAndRetry(url, wallet, requirement, init);
    return paid.response;
  }) as typeof globalThis.fetch;
}

/**
 * Agentic pay-per-request: probe the price, decide against a cap, then pay.
 *
 * @param url     resource to fetch
 * @param wallet  paying agent wallet
 * @param maxWei  hard budget cap in wei. Throws PaymentBudgetExceeded when the
 *                quoted price is higher — the agent walks away rather than
 *                overpay.
 * @param init    passthrough fetch init
 */
export async function fetchWithBudget(
  url: string,
  wallet: PayingWallet,
  maxWei: bigint,
  init?: RequestInit,
): Promise<PaidFetchResult> {
  // 1. Probe — unauthenticated request, see if payment is even required.
  const probe = await fetch(url, init);
  if (probe.status !== 402) {
    return { response: probe, payment: null };
  }

  // 2. Parse the quote from the 402 body.
  let requirement: PaymentRequirement | null = null;
  try {
    requirement = parseRequirement(await probe.json());
  } catch {
    requirement = null;
  }
  if (!requirement) {
    throw new Error("402 with no parseable payment requirement");
  }
  if (requirement.chainId && requirement.chainId !== botchainTestnet.id) {
    throw new Error(`402 payment targets unsupported chain ${requirement.chainId}`);
  }
  const priceWei = BigInt(requirement.amountWei!);

  // 3. Agentic budget decision — this is the "agent decides" moment.
  if (priceWei > maxWei) {
    throw new PaymentBudgetExceeded(priceWei, maxWei);
  }

  // 4. Pay + retry with the on-chain proof.
  const paid = await payAndRetry(url, wallet, requirement, init);
  return {
    response: paid.response,
    payment: { priceWei: paid.priceWei, txHash: paid.txHash },
  };
}
