/**
 * Payments revenue ledger — tracks the native-BOT payments Mimir's paid
 * endpoints earn.
 *
 * Durable: writes each verified payment to Neon (payments table) so the
 * dashboard survives restarts. The on-chain transfers remain the ultimate
 * source of truth. When DATABASE_URL is unset (local dev), it transparently
 * falls back to an in-memory ring buffer (last 1000 events) — never breaks
 * serving.
 */

import {
  insertPayment,
  getPaymentsRevenueSummary,
  type PaymentsRevenueSummary,
} from "./db";

export interface PaymentEvent {
  resource: string; // which endpoint earned it (e.g. /api/premium/price)
  amountBot: number; // BOT, e.g. 0.001
  payer: string | null; // buyer address
  seller: string | null; // wallet that received the payment
  txHash: string | null; // on-chain transfer hash
  at: number; // ms epoch
}

const MAX = 1000;
const events: PaymentEvent[] = [];

/**
 * Record a verified payment. Never throws — accounting must not break serving.
 * Returns the durable-write promise so callers can `await` it: on Vercel the
 * serverless function is frozen right after the response returns, which drops
 * any fire-and-forget insert still in flight. Await it to keep the function
 * alive until the row lands.
 */
export function recordPayment(e: PaymentEvent): Promise<void> {
  // In-memory mirror (instant, and the only store when no DB is configured).
  try {
    events.push(e);
    if (events.length > MAX) events.splice(0, events.length - MAX);
  } catch {
    /* ignore */
  }
  // Durable write — swallow errors (e.g. DB not configured) but log them.
  return insertPayment({
    resource: e.resource,
    amount_bot: e.amountBot,
    payer: e.payer,
    seller: e.seller,
    tx_id: e.txHash,
    at: e.at,
  }).catch((err) => {
    console.warn("[payments] durable write failed:", err instanceof Error ? err.message : err);
  });
}

export interface RevenueSummary {
  totalCalls: number;
  /** Portion of totalCalls carried over from an earlier deployment (0 when unset). */
  baselineCalls: number;
  totalBot: number;
  /** Portion of totalBot carried over from an earlier deployment (0 when unset). */
  baselineBot: number;
  uniquePayers: number;
  uniqueSellers: number;
  byResource: Array<{ resource: string; calls: number; bot: number }>;
  bySeller: Array<{ seller: string; calls: number; bot: number }>;
  recent: PaymentEvent[];
}

/**
 * Volume served before a database reset/migration. Those rows may be gone, so
 * displayed totals resume on top of these figures instead of restarting at zero.
 */
function positiveEnvNumber(key: string): number {
  const n = Number(process.env[key] ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function baselineCalls(): number {
  return Math.floor(positiveEnvNumber("PAYMENTS_BASELINE_CALLS"));
}

export function baselineBot(): number {
  return Math.round(positiveEnvNumber("PAYMENTS_BASELINE_BOT") * 1e6) / 1e6;
}

function fromDbSummary(s: PaymentsRevenueSummary): RevenueSummary {
  return {
    totalCalls: s.totalCalls,
    baselineCalls: 0,
    baselineBot: 0,
    totalBot: s.totalBot,
    uniquePayers: s.uniquePayers,
    uniqueSellers: s.uniqueSellers,
    byResource: s.byResource,
    bySeller: s.bySeller,
    recent: s.recent.map((r) => ({
      resource: r.resource,
      amountBot: r.amount_bot,
      payer: r.payer,
      seller: r.seller,
      txHash: r.tx_id,
      at: r.at,
    })),
  };
}

function inMemorySummary(limit: number): RevenueSummary {
  const byResource = new Map<string, { calls: number; bot: number }>();
  const bySeller = new Map<string, { calls: number; bot: number }>();
  const payers = new Set<string>();
  const sellers = new Set<string>();
  let totalBot = 0;
  for (const e of events) {
    totalBot += e.amountBot;
    if (e.payer) payers.add(e.payer.toLowerCase());
    if (e.seller) {
      const seller = e.seller.toLowerCase();
      sellers.add(seller);
      const s = bySeller.get(seller) ?? { calls: 0, bot: 0 };
      s.calls += 1;
      s.bot += e.amountBot;
      bySeller.set(seller, s);
    }
    const r = byResource.get(e.resource) ?? { calls: 0, bot: 0 };
    r.calls += 1;
    r.bot += e.amountBot;
    byResource.set(e.resource, r);
  }
  return {
    totalCalls: events.length,
    baselineCalls: 0,
    baselineBot: 0,
    totalBot: Math.round(totalBot * 1e6) / 1e6,
    uniquePayers: payers.size,
    uniqueSellers: sellers.size,
    byResource: [...byResource.entries()]
      .map(([resource, v]) => ({ resource, calls: v.calls, bot: Math.round(v.bot * 1e6) / 1e6 }))
      .sort((a, b) => b.bot - a.bot),
    bySeller: [...bySeller.entries()]
      .map(([seller, v]) => ({ seller, calls: v.calls, bot: Math.round(v.bot * 1e6) / 1e6 }))
      .sort((a, b) => b.bot - a.bot),
    recent: events.slice(-limit).reverse(),
  };
}

/** Durable summary from Neon; falls back to the in-memory buffer on any error. */
export async function getRevenueSummary(limit = 25): Promise<RevenueSummary> {
  const withBaseline = (s: RevenueSummary): RevenueSummary => {
    const calls = baselineCalls();
    const bot = baselineBot();
    if (calls === 0 && bot === 0) return s;
    return {
      ...s,
      totalCalls: s.totalCalls + calls,
      baselineCalls: calls,
      totalBot: Math.round((s.totalBot + bot) * 1e6) / 1e6,
      baselineBot: bot,
    };
  };
  try {
    return withBaseline(fromDbSummary(await getPaymentsRevenueSummary(limit)));
  } catch {
    return withBaseline(inMemorySummary(limit));
  }
}
