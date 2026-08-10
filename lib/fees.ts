/**
 * Fee accounting, in USDC atomic units.
 *
 * This module is the reference the v2 contract mirrors, the same way lib/payout.ts
 * mirrors Mimir.sol today. Every number is an integer; there is no floating point
 * anywhere in the accounting path.
 *
 * ── The decision that shapes everything ──────────────────────────────────────
 *
 * **Fees are charged on PROFIT, never on the gross payout.**
 *
 * Charging the gross is the obvious implementation and it is broken. Take a pool
 * market where a challenger stakes 10 USDC into a crowded side and wins 11 — a
 * profit of 1. A 20% fee on the gross 11 is 2.2, so the winner receives 8.8: they
 * were RIGHT and they lost money. No fee schedule may be able to do that, so the
 * base is profit and the invariant "a winner never receives less than their
 * principal" is enforced and tested directly.
 *
 * ── The other rules ──────────────────────────────────────────────────────────
 *
 *  - No fee is taken at deposit. Fees exist on settlement, so a market that never
 *    resolves costs its participants nothing.
 *  - Draws, unresolvable outcomes and cancellations are refunded IN FULL. There is
 *    no profit to charge, and taking a cut of a returned stake would make Mimir
 *    the only winner of an ambiguous market.
 *  - The policy is SNAPSHOT at create time. A market's economics cannot change
 *    under its participants after they have committed money.
 *  - Fees accrue to a claimable balance rather than being pushed. A push to a
 *    contract that reverts would take the whole settlement down with it.
 */

export const BPS_DIVISOR = 10_000n;

/** Nothing may ever take more than this in total. Enforced, not advisory. */
export const MAX_TOTAL_FEE_BPS = 1_000n; // 10%

export interface FeePolicy {
  /** Protocol share of profit, basis points. */
  platformFeeBps: number;
  /** Attributed agent owner's share of profit, basis points. */
  agentOwnerFeeBps: number;
  platformRecipient: string;
  /** Null when the market was not created by a registered agent. */
  agentOwnerRecipient: string | null;
}

export interface PolicyValidation {
  ok: boolean;
  errors: string[];
}

/**
 * A policy must be valid before it can be snapshot onto a claim.
 *
 * The total cap exists so no future admin action — or bug — can produce a market
 * that takes most of a winner's profit.
 */
export function validateFeePolicy(policy: FeePolicy): PolicyValidation {
  const errors: string[] = [];
  const platform = BigInt(Math.trunc(policy.platformFeeBps));
  const owner = BigInt(Math.trunc(policy.agentOwnerFeeBps));

  if (!Number.isInteger(policy.platformFeeBps) || platform < 0n) {
    errors.push("platformFeeBps must be a non-negative integer");
  }
  if (!Number.isInteger(policy.agentOwnerFeeBps) || owner < 0n) {
    errors.push("agentOwnerFeeBps must be a non-negative integer");
  }
  if (platform + owner > MAX_TOTAL_FEE_BPS) {
    errors.push(`total fee ${platform + owner} bps exceeds the ${MAX_TOTAL_FEE_BPS} bps cap`);
  }
  if (platform > 0n && !policy.platformRecipient) {
    errors.push("a platform fee needs a recipient");
  }
  // An owner fee with nobody to pay is a silent loss of funds to the escrow.
  if (owner > 0n && !policy.agentOwnerRecipient) {
    errors.push("an agent owner fee needs an attributed recipient");
  }
  return { ok: errors.length === 0, errors };
}

/** The immutable copy stored on a claim at creation. */
export interface FeeSnapshot {
  platformFeeBps: number;
  agentOwnerFeeBps: number;
  platformRecipient: string;
  agentOwnerRecipient: string | null;
  /** Set when the market is attributed to a registered agent. */
  agentId: string | null;
  takenAt: number;
}

/**
 * Freeze a policy onto a claim.
 *
 * Snapshotting is what stops a fee change from reaching markets that are already
 * open — participants committed money under the terms they could see.
 */
export function snapshotFeePolicy(
  policy: FeePolicy,
  args: { agentId?: string | null; at?: number } = {},
): FeeSnapshot {
  return {
    platformFeeBps: Math.trunc(policy.platformFeeBps),
    agentOwnerFeeBps: Math.trunc(policy.agentOwnerFeeBps),
    platformRecipient: policy.platformRecipient.toLowerCase(),
    agentOwnerRecipient: policy.agentOwnerRecipient?.toLowerCase() ?? null,
    agentId: args.agentId ?? null,
    takenAt: args.at ?? Date.now(),
  };
}

// ── Settlement outcomes ───────────────────────────────────────────────────────

export type SettlementOutcome =
  | "creator_wins"
  | "challengers_win"
  | "draw"
  | "unresolvable"
  | "cancelled";

/** Outcomes that return every stake and therefore carry no fee. */
export function isRefundOutcome(outcome: SettlementOutcome): boolean {
  return outcome === "draw" || outcome === "unresolvable" || outcome === "cancelled";
}

export interface FeeSplit {
  /** Winner's own stake, always returned untouched. */
  principalUnits: bigint;
  /** Profit before fees. */
  grossProfitUnits: bigint;
  platformFeeUnits: bigint;
  agentOwnerFeeUnits: bigint;
  /** Profit after fees. */
  netProfitUnits: bigint;
  /** What the winner actually receives. */
  payoutUnits: bigint;
}

/**
 * Split one winner's payout into principal, fees and net profit.
 *
 * Integer division truncates, which means fees round DOWN — in the participant's
 * favour. The remainder is not lost: `settleMarket` accounts for it as dust.
 */
export function splitFees(args: {
  principalUnits: bigint;
  grossPayoutUnits: bigint;
  snapshot: FeeSnapshot;
  outcome: SettlementOutcome;
}): FeeSplit {
  const { principalUnits, grossPayoutUnits, snapshot, outcome } = args;

  // A refund is returned whole. There is no profit to charge, and taking a cut of
  // a returned stake would make Mimir the only winner of an ambiguous market.
  if (isRefundOutcome(outcome)) {
    return {
      principalUnits,
      grossProfitUnits: 0n,
      platformFeeUnits: 0n,
      agentOwnerFeeUnits: 0n,
      netProfitUnits: 0n,
      payoutUnits: principalUnits,
    };
  }

  const grossProfitUnits =
    grossPayoutUnits > principalUnits ? grossPayoutUnits - principalUnits : 0n;

  const platformFeeUnits =
    (grossProfitUnits * BigInt(snapshot.platformFeeBps)) / BPS_DIVISOR;
  const agentOwnerFeeUnits =
    (grossProfitUnits * BigInt(snapshot.agentOwnerFeeBps)) / BPS_DIVISOR;

  const netProfitUnits = grossProfitUnits - platformFeeUnits - agentOwnerFeeUnits;
  return {
    principalUnits,
    grossProfitUnits,
    platformFeeUnits,
    agentOwnerFeeUnits,
    netProfitUnits,
    // Fees are deducted from the GROSS PAYOUT, not added on top of principal.
    // Returning `principal + netProfit` would hand a loser their stake back — and
    // a loser's stake is precisely what pays the winner. A losing participant has
    // a gross payout of zero and therefore receives zero.
    //
    // The "winner never receives less than principal" invariant still holds:
    // fees are charged only on profit, so the deduction can never exceed profit.
    payoutUnits: grossPayoutUnits - platformFeeUnits - agentOwnerFeeUnits,
  };
}

// ── Whole-market settlement ───────────────────────────────────────────────────

export interface Participant {
  address: string;
  stakeUnits: bigint;
  /** Gross payout before fees, from lib/payout.ts. */
  grossPayoutUnits: bigint;
}

export interface AccrualLine {
  recipient: string;
  amountUnits: bigint;
  kind: "platform_fee" | "agent_owner_fee";
}

export interface MarketSettlement {
  /** Everything paid to participants, per address. */
  payouts: Array<{ address: string; amountUnits: bigint }>;
  accruals: AccrualLine[];
  totalPayoutUnits: bigint;
  totalPlatformFeeUnits: bigint;
  totalAgentOwnerFeeUnits: bigint;
  /** Truncation remainder left in escrow. Accounted for, never ignored. */
  dustUnits: bigint;
  /** Total the escrow received for this market. */
  escrowInflowUnits: bigint;
}

/**
 * Settle a market and account for every atomic unit.
 *
 * The invariant this function exists to make checkable:
 *
 *   sum(payouts) + platformFees + agentOwnerFees + dust == escrowInflow
 *
 * Dust is the deliberate slack: pool shares and fees both truncate, so a few
 * units can be left over. They stay in escrow and are reported, because a
 * conservation check that ignores a residue does not prove conservation.
 */
export function settleMarket(args: {
  participants: Participant[];
  snapshot: FeeSnapshot;
  outcome: SettlementOutcome;
}): MarketSettlement {
  const { participants, snapshot, outcome } = args;

  const escrowInflowUnits = participants.reduce((sum, p) => sum + p.stakeUnits, 0n);

  const payouts: Array<{ address: string; amountUnits: bigint }> = [];
  let totalPayoutUnits = 0n;
  let totalPlatformFeeUnits = 0n;
  let totalAgentOwnerFeeUnits = 0n;

  for (const participant of participants) {
    const split = splitFees({
      principalUnits: participant.stakeUnits,
      grossPayoutUnits: participant.grossPayoutUnits,
      snapshot,
      outcome,
    });
    if (split.payoutUnits > 0n) {
      payouts.push({ address: participant.address, amountUnits: split.payoutUnits });
      totalPayoutUnits += split.payoutUnits;
    }
    totalPlatformFeeUnits += split.platformFeeUnits;
    totalAgentOwnerFeeUnits += split.agentOwnerFeeUnits;
  }

  const accruals: AccrualLine[] = [];
  if (totalPlatformFeeUnits > 0n) {
    accruals.push({
      recipient: snapshot.platformRecipient,
      amountUnits: totalPlatformFeeUnits,
      kind: "platform_fee",
    });
  }
  if (totalAgentOwnerFeeUnits > 0n && snapshot.agentOwnerRecipient) {
    accruals.push({
      recipient: snapshot.agentOwnerRecipient,
      amountUnits: totalAgentOwnerFeeUnits,
      kind: "agent_owner_fee",
    });
  }

  const dustUnits =
    escrowInflowUnits - totalPayoutUnits - totalPlatformFeeUnits - totalAgentOwnerFeeUnits;

  return {
    payouts,
    accruals,
    totalPayoutUnits,
    totalPlatformFeeUnits,
    totalAgentOwnerFeeUnits,
    dustUnits,
    escrowInflowUnits,
  };
}

/**
 * Merge accrual lines that share a recipient.
 *
 * The creator, the agent owner and the platform can all be the same address —
 * commonly are, in testing. Emitting two lines for one address would double-count
 * in any downstream sum, so they are merged once, here.
 */
export function mergeAccruals(accruals: AccrualLine[]): Array<{ recipient: string; amountUnits: bigint }> {
  const byRecipient = new Map<string, bigint>();
  for (const line of accruals) {
    const key = line.recipient.toLowerCase();
    byRecipient.set(key, (byRecipient.get(key) ?? 0n) + line.amountUnits);
  }
  return [...byRecipient.entries()]
    .map(([recipient, amountUnits]) => ({ recipient, amountUnits }))
    .sort((a, b) => a.recipient.localeCompare(b.recipient));
}

/** The conservation check, as a function so tests and an indexer share it. */
export function conservationHolds(settlement: MarketSettlement): boolean {
  return (
    settlement.totalPayoutUnits +
      settlement.totalPlatformFeeUnits +
      settlement.totalAgentOwnerFeeUnits +
      settlement.dustUnits ===
    settlement.escrowInflowUnits
  );
}

/**
 * The other invariant worth naming: nobody who won receives less than they put
 * in. This is what makes charging on profit rather than gross non-negotiable.
 */
export function noWinnerLosesPrincipal(
  participants: Participant[],
  settlement: MarketSettlement,
): boolean {
  const paid = new Map(settlement.payouts.map((p) => [p.address.toLowerCase(), p.amountUnits]));
  return participants.every((participant) => {
    const won = participant.grossPayoutUnits > participant.stakeUnits;
    if (!won) return true;
    return (paid.get(participant.address.toLowerCase()) ?? 0n) >= participant.stakeUnits;
  });
}
