/**
 * Per-actor records, folded from settled markets (§6.6, §6.7).
 *
 * This is a projection in the same sense as `lib/ops/projection.ts`: a pure
 * function of settled positions, so a leaderboard can be thrown away and rebuilt
 * from chain events and come back identical. Nothing here is a stored score —
 * storing one would make the leaderboard a second source of truth that could
 * drift from the escrow it claims to describe.
 *
 * Design rules, each tested:
 *
 *  - **A refund does not break a streak and does not enter a rate.** Draws,
 *    unresolvable outcomes and cancellations return every stake; counting one as a
 *    loss would punish a user for an ambiguity that was not their doing, and
 *    counting it as a win would invent a result.
 *  - **Agents and humans rank separately.** An agent staking every hour will
 *    out-volume any person, so one merged table just lists the agents.
 *  - **Ties are ordered deterministically, never by insertion.** A leaderboard that
 *    reorders between two rebuilds of the same history is not a leaderboard.
 */

import { computeConviction, computeStreak, type ScoredPosition } from "@/lib/scoring";

export type ActorType = "human" | "agent";

export interface LeaderboardEntry {
  address: string;
  actorType: ActorType;
  currentStreak: number;
  bestStreak: number;
  resolvedCount: number;
  wins: number;
  losses: number;
  refunds: number;
  winRateBps: number | null;
  convictionScore: number;
  /** Realized profit and loss in display USDC. Negative is a real result. */
  realizedPnlUsdc: number;
  /** Positions taken early on the minority side — the "early backer" marker. */
  earlyUnderdogCount: number;
  /** Categories this actor has settled positions in, sorted. */
  categories: string[];
}

export interface LeaderboardInput {
  address: string;
  actorType: ActorType;
  positions: ScoredPosition[];
  /**
   * Gross payout per winning claim, in display USDC.
   *
   * Passed through to computeConviction rather than a pre-computed PnL, so the
   * money number on the leaderboard is derived by the same code as everywhere else
   * — two places computing PnL is two places for it to disagree.
   */
  payouts?: Map<number, number>;
}

export interface LeaderboardOptions {
  /** Only positions in this category count. */
  category?: string;
  /**
   * Minimum decisive results before an actor is ranked.
   *
   * Without it, one lucky win is a 100% win rate at the top of the table, and the
   * leaderboard rewards not playing.
   */
  minResolved?: number;
  sortBy?: "conviction" | "winRate" | "streak" | "volume";
}

export const DEFAULT_MIN_RESOLVED = 3;

/**
 * Actors with too few decisive results to rank, kept so the UI can say "3 more to
 * qualify" rather than silently omitting somebody who is playing.
 */
export interface Leaderboard {
  ranked: LeaderboardEntry[];
  unranked: LeaderboardEntry[];
  minResolved: number;
}

function statsFor(input: LeaderboardInput, category?: string): LeaderboardEntry {
  const positions = category
    ? input.positions.filter((p) => (p.category ?? "").toLowerCase() === category.toLowerCase())
    : input.positions;

  const streak = computeStreak(positions);
  const conviction = computeConviction(positions, input.payouts);

  return {
    address: input.address.toLowerCase(),
    actorType: input.actorType,
    currentStreak: streak.currentStreak,
    bestStreak: streak.bestStreak,
    resolvedCount: streak.resolvedCount,
    wins: streak.wins,
    losses: streak.losses,
    refunds: streak.refunds,
    winRateBps: streak.winRateBps,
    convictionScore: conviction.score,
    realizedPnlUsdc: conviction.realizedPnlUsdc,
    earlyUnderdogCount: conviction.earlyUnderdogCount,
    categories: [
      ...new Set(positions.map((p) => (p.category ?? "").trim()).filter((c) => c.length > 0)),
    ].sort(),
  };
}

/**
 * Deterministic ordering.
 *
 * The chosen metric first, then a fixed chain of tiebreaks ending in the address —
 * which is unique, so two rebuilds of the same history always produce the same
 * order. Falling back to insertion order would make the ranking depend on the
 * order rows came back from a query.
 */
function comparator(sortBy: LeaderboardOptions["sortBy"]) {
  return (a: LeaderboardEntry, b: LeaderboardEntry): number => {
    const primary =
      sortBy === "winRate"
        ? (b.winRateBps ?? -1) - (a.winRateBps ?? -1)
        : sortBy === "streak"
          ? b.currentStreak - a.currentStreak
          : sortBy === "volume"
            ? b.resolvedCount - a.resolvedCount
            : b.convictionScore - a.convictionScore;
    if (primary !== 0) return primary;
    if (b.convictionScore !== a.convictionScore) return b.convictionScore - a.convictionScore;
    if (b.resolvedCount !== a.resolvedCount) return b.resolvedCount - a.resolvedCount;
    return a.address.localeCompare(b.address);
  };
}

export function buildLeaderboard(
  inputs: LeaderboardInput[],
  options: LeaderboardOptions = {},
): Leaderboard {
  const minResolved = options.minResolved ?? DEFAULT_MIN_RESOLVED;
  const entries = inputs.map((input) => statsFor(input, options.category));
  const sort = comparator(options.sortBy);

  return {
    // An actor with no decisive results in the filtered set is not "0-0 ranked
    // last" — it has not played, which is a different thing.
    ranked: entries.filter((e) => e.resolvedCount >= minResolved).sort(sort),
    unranked: entries.filter((e) => e.resolvedCount < minResolved).sort(sort),
    minResolved,
  };
}

/** Separate tables per actor type. Agents out-volume people, so one table is theirs. */
export function splitByActorType(
  inputs: LeaderboardInput[],
  options: LeaderboardOptions = {},
): Record<ActorType, Leaderboard> {
  return {
    human: buildLeaderboard(
      inputs.filter((i) => i.actorType === "human"),
      options,
    ),
    agent: buildLeaderboard(
      inputs.filter((i) => i.actorType === "agent"),
      options,
    ),
  };
}

/**
 * Streak framing for the UI.
 *
 * Deliberately does NOT return anything like "your streak is at risk — defend it".
 * A streak is a record of what happened; language that treats it as something to
 * protect pushes a user into a stake they would not otherwise take, which is the
 * one thing a scoring overlay must not do.
 */
export type StreakTone = "none" | "winning" | "losing";

export interface StreakBadge {
  tone: StreakTone;
  /** Magnitude, always positive. The tone carries the direction. */
  length: number;
  /** True once the run ties or beats the actor's own best. */
  isPersonalBest: boolean;
}

export function streakBadge(entry: LeaderboardEntry): StreakBadge {
  if (entry.currentStreak === 0) return { tone: "none", length: 0, isPersonalBest: false };
  const length = Math.abs(entry.currentStreak);
  return {
    tone: entry.currentStreak > 0 ? "winning" : "losing",
    length,
    // A losing run is never a personal best, however long — the badge would read
    // as an achievement.
    isPersonalBest: entry.currentStreak > 0 && entry.currentStreak >= entry.bestStreak,
  };
}
