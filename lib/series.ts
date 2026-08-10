/**
 * Rematch ladders — turning a chain of `parentId` links into a readable series.
 *
 * The contract stores one field: each claim's `parentId`. Everything a user sees
 * as a rivalry — round numbers, the running score, whether a best-of is already
 * decided — is derived here, off chain.
 *
 * Two things this module must not do:
 *
 *  1. **Hang on a malformed chain.** `parentId` is caller-supplied and unvalidated
 *     on chain, so a claim can point at itself or a descendant. A naive
 *     parent-walk loops forever. Every traversal here is cycle-guarded.
 *  2. **Count a refund as a win.** Draws, unresolvable outcomes and cancellations
 *     return everyone's stake; treating them as results would invent a winner and
 *     inflate a series score.
 */

export type SeriesWinner = "creator" | "challengers" | "none";

/** The minimum a claim must expose to take part in a series. */
export interface SeriesClaim {
  id: number;
  parentId: number;
  state: "open" | "active" | "resolved" | "cancelled";
  winnerSide: "creator" | "challengers" | "draw" | "unresolvable" | "";
  createdAt?: number;
}

export interface SeriesRound {
  claimId: number;
  round: number;
  /** "none" while unresolved, and for draws, unresolvable outcomes and cancels. */
  winner: SeriesWinner;
  /** True when the outcome returned every stake instead of picking a side. */
  refunded: boolean;
  decided: boolean;
}

export interface Series {
  /** The oldest ancestor reachable from the queried claim. */
  rootId: number;
  rounds: SeriesRound[];
  creatorWins: number;
  challengerWins: number;
  /** Rounds that settled without a winner — shown, but not scored. */
  refundedRounds: number;
  /** Round number the next rematch would take. */
  nextRound: number;
  /** True when a malformed parent chain was detected and broken. */
  cycleDetected: boolean;
  /** Set when more than one child shares a parent — a branch, not a line. */
  branchedAt: number[];
}

/**
 * A settled claim only counts toward a series when it actually picked a side.
 * Draws, unresolvable outcomes and cancellations refund and score nothing.
 */
export function roundWinner(claim: SeriesClaim): SeriesWinner {
  if (claim.state !== "resolved") return "none";
  if (claim.winnerSide === "creator") return "creator";
  if (claim.winnerSide === "challengers") return "challengers";
  return "none";
}

export function isRefundedOutcome(claim: SeriesClaim): boolean {
  if (claim.state === "cancelled") return true;
  return (
    claim.state === "resolved" &&
    (claim.winnerSide === "draw" || claim.winnerSide === "unresolvable")
  );
}

/**
 * Walk to the oldest ancestor, breaking on a cycle rather than looping.
 *
 * A claim whose parent is itself, or whose ancestry loops, is treated as the root
 * of its own series — the alternative is an infinite loop in a read path.
 */
export function findRoot(
  claimId: number,
  byId: Map<number, SeriesClaim>,
): { rootId: number; cycleDetected: boolean } {
  const seen = new Set<number>([claimId]);
  // The deepest ancestor we actually HOLD. The read-index serves a window of
  // claims, so an ancestor can exist on chain and be absent here — returning its
  // id would give callers a root they cannot resolve, and the series would render
  // empty.
  let lastKnown = claimId;
  let current = claimId;

  for (;;) {
    const claim = byId.get(current);
    if (!claim) return { rootId: lastKnown, cycleDetected: false };
    lastKnown = current;
    if (claim.parentId <= 0) return { rootId: current, cycleDetected: false };
    if (seen.has(claim.parentId)) {
      // Self-parent or a loop: stop here and report it rather than spinning.
      return { rootId: current, cycleDetected: true };
    }
    seen.add(claim.parentId);
    current = claim.parentId;
  }
}

/**
 * Build the series containing `claimId`.
 *
 * Rounds are ordered by depth from the root, then by creation time, then by id —
 * so two rematches created in the same block still order deterministically
 * instead of flickering between renders.
 */
export function buildSeries(claimId: number, claims: SeriesClaim[]): Series {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const { rootId, cycleDetected: rootCycle } = findRoot(claimId, byId);

  const childrenOf = new Map<number, SeriesClaim[]>();
  for (const claim of claims) {
    if (claim.parentId > 0 && claim.parentId !== claim.id) {
      const siblings = childrenOf.get(claim.parentId) ?? [];
      siblings.push(claim);
      childrenOf.set(claim.parentId, siblings);
    }
  }

  const branchedAt: number[] = [];
  const rounds: SeriesRound[] = [];
  const visited = new Set<number>();

  // Breadth-first from the root so depth IS the round number.
  let frontier: SeriesClaim[] = [];
  const root = byId.get(rootId);
  if (root) frontier = [root];

  let round = 1;
  let cycleDetected = rootCycle;

  while (frontier.length > 0) {
    const ordered = [...frontier].sort(
      (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id - b.id,
    );
    const next: SeriesClaim[] = [];

    for (const claim of ordered) {
      if (visited.has(claim.id)) {
        // Reachable twice means the chain is not a tree.
        cycleDetected = true;
        continue;
      }
      visited.add(claim.id);

      const winner = roundWinner(claim);
      rounds.push({
        claimId: claim.id,
        round,
        winner,
        refunded: isRefundedOutcome(claim),
        decided: winner !== "none",
      });

      const children = childrenOf.get(claim.id) ?? [];
      // More than one child from a single claim is a branch, not a line: the UI
      // must not present parallel rematches as one sequence.
      if (children.length > 1) branchedAt.push(claim.id);
      for (const child of children) {
        if (visited.has(child.id)) {
          cycleDetected = true;
          continue;
        }
        next.push(child);
      }
    }

    frontier = next;
    round += 1;
  }

  const creatorWins = rounds.filter((r) => r.winner === "creator").length;
  const challengerWins = rounds.filter((r) => r.winner === "challengers").length;

  return {
    rootId,
    rounds,
    creatorWins,
    challengerWins,
    refundedRounds: rounds.filter((r) => r.refunded).length,
    // The next rematch continues the line, so it is one past the deepest round.
    nextRound: rounds.length === 0 ? 1 : Math.max(...rounds.map((r) => r.round)) + 1,
    cycleDetected,
    branchedAt,
  };
}

// ── Best-of series ────────────────────────────────────────────────────────────

export interface BestOfStatus {
  bestOf: number;
  /** Wins needed to take the series. */
  target: number;
  creatorWins: number;
  challengerWins: number;
  decided: boolean;
  leader: SeriesWinner;
  /** Decisive rounds still available. Refunds do not consume one. */
  roundsRemaining: number;
}

/**
 * Status of a best-of-N series.
 *
 * Only DECISIVE rounds count toward N. A best-of-3 that draws twice is still
 * 0–0 with three decisive rounds to play — otherwise a pair of refunds would
 * silently end a series nobody won.
 */
export function bestOfStatus(series: Series, bestOf: number): BestOfStatus {
  const target = Math.floor(bestOf / 2) + 1;
  const decisive = series.creatorWins + series.challengerWins;
  const leader: SeriesWinner =
    series.creatorWins > series.challengerWins
      ? "creator"
      : series.challengerWins > series.creatorWins
        ? "challengers"
        : "none";
  return {
    bestOf,
    target,
    creatorWins: series.creatorWins,
    challengerWins: series.challengerWins,
    decided: series.creatorWins >= target || series.challengerWins >= target,
    leader,
    roundsRemaining: Math.max(0, bestOf - decisive),
  };
}

// ── Inheriting a parent's terms ───────────────────────────────────────────────

/** Fields a rematch inherits verbatim from its parent. */
export interface RematchInheritance {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  marketType: string;
  oddsMode: string;
  challengerPayoutBps: number;
  handicapLine: string;
  settlementRule: string;
  maxChallengers: number;
  isPrivate: boolean;
}

/**
 * A settlement rule too thin to re-run without review.
 *
 * Copying a vague rule into a rematch reproduces the ambiguity that made the
 * first round contentious, so the UI must force a correction step rather than
 * silently inheriting it.
 */
export const MIN_SETTLEMENT_RULE_CHARS = 16;

export interface RematchReadiness {
  ready: boolean;
  /** Fields the user must revisit before the rematch can be created. */
  needsReview: Array<"settlementRule" | "resolutionUrl" | "deadline" | "stake">;
}

export function rematchReadiness(parent: RematchInheritance): RematchReadiness {
  const needsReview: RematchReadiness["needsReview"] = [];
  if ((parent.settlementRule ?? "").trim().length < MIN_SETTLEMENT_RULE_CHARS) {
    needsReview.push("settlementRule");
  }
  if (!/^https?:\/\//.test(parent.resolutionUrl ?? "")) needsReview.push("resolutionUrl");
  // Always re-chosen: a deadline and a stake copied from a settled market are
  // meaningless in a new one.
  needsReview.push("deadline", "stake");
  return { ready: !needsReview.includes("settlementRule") && !needsReview.includes("resolutionUrl"), needsReview };
}
