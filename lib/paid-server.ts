/**
 * Server side of Mimir's paid resources — sell data/services per request over
 * HTTP 402, settled with plain native BOT transfers on BOT Chain.
 *
 * Usage in a route handler:
 *   const gate = await requireBotPayment(req, "0.001");
 *   if (!gate.paid) return gate.response;      // 402 with payment requirements
 *   // ...produce the paid content...
 *   return json(data, { headers: gate.responseHeaders });
 *
 * The buyer pays by sending a native BOT transfer to the quoted `payTo`
 * address, then retries with `X-Payment-Tx: <txHash>`. This module verifies
 * the transfer on-chain (recipient, amount, sender, freshness, no replay)
 * before serving.
 */

import "server-only";
import { parseEther } from "viem";
import { baseSepolia, createBasePublicClient } from "./base";
import { recordPayment } from "./paid-revenue";
import { hasPaymentTx } from "./db";

/** A payment tx stays valid for one hour — plenty for a pay-then-retry round trip. */
const MAX_PAYMENT_AGE_MS = 60 * 60 * 1000;

/** In-process replay guard (best-effort; the DB lookup below is the durable layer). */
const usedTx = new Set<string>();
const MAX_USED_TX = 10_000;

function sellerAddress(payTo?: string): `0x${string}` {
  const addr = payTo ?? process.env.SELLER_ADDRESS;
  if (!addr || !addr.startsWith("0x")) {
    throw new Error("SELLER_ADDRESS is required to sell paid resources");
  }
  return addr as `0x${string}`;
}

function paymentRequired(args: {
  amountUsdc: string;
  amountUnits: bigint;
  payTo: `0x${string}`;
  resource: string;
  reason?: string;
}): Response {
  return json(
    {
      error: "payment required",
      ...(args.reason ? { reason: args.reason } : {}),
      payment: {
        scheme: "native-transfer",
        chainId: baseSepolia.id,
        currency: "BOT",
        amount: args.amountUsdc,
        amountUnits: args.amountUnits.toString(),
        payTo: args.payTo,
        resource: args.resource,
        description:
          "Send the exact BOT amount to payTo on BOT Chain, then retry with the X-Payment-Tx header set to the transaction hash.",
      },
    },
    { status: 402 },
  );
}

export type RequirePaymentResult =
  | {
      paid: true;
      payer: `0x${string}`;
      txHash: `0x${string}`;
      responseHeaders: Headers;
    }
  | { paid: false; response: Response };

/**
 * Verify the buyer's payment proof against the chain. Returns either a
 * ready-to-send 402 (with payment requirements) or a "paid" verdict carrying
 * the payer address and tx hash.
 *
 * @param req      the Next Request
 * @param amountUsdc decimal BOT price string, e.g. "0.001"
 */
export async function requireBotPayment(
  req: Request,
  amountUsdc: string,
  opts?: { payTo?: string },
): Promise<RequirePaymentResult> {
  const payTo = sellerAddress(opts?.payTo).toLowerCase() as `0x${string}`;
  const amountUnits = parseEther(amountUsdc);
  const resource = new URL(req.url).pathname;

  const txHash = req.headers.get("x-payment-tx")?.trim() as `0x${string}` | undefined;
  const fromHeader = req.headers.get("x-payment-from")?.trim().toLowerCase();
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { paid: false, response: paymentRequired({ amountUsdc, amountUnits, payTo, resource }) };
  }

  const fail = (reason: string): RequirePaymentResult => ({
    paid: false,
    response: paymentRequired({ amountUsdc, amountUnits, payTo, resource, reason }),
  });

  // Replay guards — in-process first (cheap), then the durable ledger.
  const txKey = txHash.toLowerCase();
  if (usedTx.has(txKey)) return fail("payment tx already used");
  try {
    if (await hasPaymentTx(txKey)) return fail("payment tx already used");
  } catch {
    /* DB not configured — the in-memory guard still applies */
  }

  let tx;
  let receipt;
  try {
    const client = createBasePublicClient();
    [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash }),
      client.getTransactionReceipt({ hash: txHash }),
    ]);
  } catch {
    return fail("payment tx not found on BOT Chain");
  }

  if (receipt.status !== "success") return fail("payment tx reverted");
  if (!tx.to || tx.to.toLowerCase() !== payTo) return fail(`payment must go to ${payTo}`);
  if (tx.value < amountUnits) return fail(`payment underpaid: expected ≥ ${amountUsdc} BOT`);
  const payer = tx.from.toLowerCase() as `0x${string}`;
  if (fromHeader && fromHeader !== payer) return fail("x-payment-from does not match tx sender");

  // Freshness — an ancient transfer must not unlock new reads forever.
  try {
    const block = await createBasePublicClient().getBlock({ blockNumber: receipt.blockNumber });
    if (Date.now() - Number(block.timestamp) * 1000 > MAX_PAYMENT_AGE_MS) {
      return fail("payment tx is too old");
    }
  } catch {
    /* block lookup failed — the other checks still hold */
  }

  usedTx.add(txKey);
  if (usedTx.size > MAX_USED_TX) {
    const first = usedTx.values().next().value;
    if (first) usedTx.delete(first);
  }

  // Record it for the revenue dashboard. Awaited: on Vercel the serverless
  // function freezes right after the response returns, which drops any
  // fire-and-forget insert still in flight.
  await recordPayment({
    resource,
    amountUsdc: Number(amountUsdc),
    payer,
    seller: payTo,
    txHash: txKey,
    at: Date.now(),
  });

  return {
    paid: true,
    payer,
    txHash: txKey as `0x${string}`,
    responseHeaders: new Headers({ "x-payment-tx": txKey }),
  };
}

/** JSON Response helper that merges extra headers (e.g. X-Payment-Tx). */
export function json(data: unknown, init?: { status?: number; headers?: Headers }): Response {
  const headers = init?.headers ?? new Headers();
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(data), { status: init?.status ?? 200, headers });
}
