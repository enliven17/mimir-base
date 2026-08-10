/**
 * Council subscription — one payment buys a window of free council reads.
 *
 * POST /api/council/subscribe   (0.01 BOT → platform seller)
 *   → { pass, expiresAt, plan }
 *
 * Pass the returned token to /api/council/reasoning?...&pass=<pass> and reads
 * are free until it expires (default 10 min). This is the recurring/streaming
 * access tier on top of the per-read payment. Unpaid → 402.
 */

import { requireBotPayment, json } from "@/lib/paid-server";
import { issuePass } from "@/lib/paid-pass";

const PRICE = "0.01";
const PLAN = "council";
const TTL_MS = Number(process.env.COUNCIL_PASS_TTL_MS ?? 10 * 60 * 1000);

export async function POST(req: Request): Promise<Response> {
  const gate = await requireBotPayment(req, PRICE);
  if (!gate.paid) return gate.response;

  // Bind the pass to whoever paid (verified on-chain sender).
  const payer = gate.payer;
  const { pass, expiresAt } = issuePass(payer, PLAN, TTL_MS);
  return json(
    { plan: PLAN, payer, pass, expiresAt, ttlMs: TTL_MS, price: `${PRICE} BOT` },
    { headers: gate.responseHeaders },
  );
}
