/**
 * Share card content model.
 *
 * Split from the renderer so the privacy rules are testable without rendering an
 * image. The rules that matter:
 *
 *  1. **A private market's card never reveals the claim.** The card URL carries
 *     only the public claim id, and a private claim renders a locked placeholder.
 *     Anyone can request /api/share/12 — an OG scraper does, by definition — so
 *     the card must be safe for someone holding no invite key.
 *  2. **The invite key is never in the URL, the image, or a cache key.** Share
 *     cards are cached by URL at the CDN; a key in the URL would be cached and
 *     logged by every hop.
 *  3. Long claims are truncated on a word boundary so the card never overflows,
 *     and the truncation is visible rather than silent.
 */

import type { CanonicalMode, SettlementMode } from "./market-modes";
import { SETTLEMENT_MODE_POLICY } from "./market-modes";

export type ShareCardKind = "market" | "settlement" | "duel" | "rematch";

/** Open Graph default plus the platform sizes the roadmap names. */
export const CARD_SIZES = {
  og: { width: 1200, height: 630 },
  x: { width: 1200, height: 675 },
  farcaster: { width: 1200, height: 800 },
} as const;

export type CardSize = keyof typeof CARD_SIZES;

export function isCardSize(value: string): value is CardSize {
  return value in CARD_SIZES;
}

export const MAX_CLAIM_CHARS = 140;
export const MAX_SIDE_CHARS = 48;

export interface ShareCardInput {
  claimId: number;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  /** Display USDC. */
  totalPot: number;
  mode: CanonicalMode;
  deadline: number;
  state: "open" | "active" | "resolved" | "cancelled";
  isPrivate: boolean;
  winnerSide?: "creator" | "challengers" | "draw" | "unresolvable" | "";
  /** Display USDC paid to the winning side. */
  payout?: number;
  /** Rematch series position, when this claim is part of a ladder. */
  series?: { round: number; bestOf?: number; creatorWins: number; challengerWins: number };
}

export interface ShareCard {
  kind: ShareCardKind;
  size: { width: number; height: number };
  /** Headline. For a private market this is a locked placeholder. */
  title: string;
  sideA: string;
  sideB: string;
  /** Registrable domain of the resolution source, or "" when withheld. */
  sourceDomain: string;
  potLabel: string;
  modeLabel: string;
  /** "Winner takes pot" for a duel, etc. Empty when not applicable. */
  economicsLabel: string;
  deadlineIso: string;
  verdictLabel: string;
  payoutLabel: string;
  seriesLabel: string;
  /** True when detail is withheld because the market is private. */
  locked: boolean;
}

function truncateOnWord(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Truncation is visible, never silent.
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function shareCardDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function economicsLabel(mode: SettlementMode): string {
  switch (mode) {
    case "duel":
      return "Winner takes the pot";
    case "fixed_odds":
      return "Creator-backed fixed odds";
    case "pool":
      return "Proportional pool payout";
    default:
      return "";
  }
}

function verdictLabel(input: ShareCardInput): string {
  if (input.state === "cancelled") return "Cancelled — stakes refunded";
  if (input.state !== "resolved") return "";
  switch (input.winnerSide) {
    case "creator":
      return "Creator wins";
    case "challengers":
      return input.mode.settlementMode === "duel" ? "Rival wins" : "Challengers win";
    case "draw":
      return "Draw — refunded in full";
    case "unresolvable":
      return "Unresolvable — refunded in full";
    default:
      return "Settled";
  }
}

function seriesLabel(input: ShareCardInput): string {
  const series = input.series;
  if (!series) return "";
  const score = `${series.creatorWins}–${series.challengerWins}`;
  if (series.bestOf) return `Round ${series.round} · Best of ${series.bestOf} · ${score}`;
  return `Round ${series.round} · ${score}`;
}

function cardKind(input: ShareCardInput): ShareCardKind {
  if (input.series) return "rematch";
  if (input.state === "resolved" || input.state === "cancelled") return "settlement";
  if (input.mode.settlementMode === "duel") return "duel";
  return "market";
}

/**
 * Build the card content. Deterministic: the same claim state always produces the
 * same card, so the CDN can cache it and two viewers see the same thing.
 */
export function buildShareCard(input: ShareCardInput, size: CardSize = "og"): ShareCard {
  const dimensions = CARD_SIZES[size];
  const policy = SETTLEMENT_MODE_POLICY[input.mode.settlementMode];

  // A private market's card is requested by scrapers and strangers, so it must
  // be safe for someone with no invite key: no question, no sides, no source.
  if (input.isPrivate) {
    return {
      kind: cardKind(input),
      size: dimensions,
      title: "Private claim on Mimir",
      sideA: "Invite only",
      sideB: "Invite only",
      sourceDomain: "",
      potLabel: "",
      modeLabel: policy?.label ?? "",
      economicsLabel: "",
      deadlineIso: "",
      verdictLabel: "",
      payoutLabel: "",
      seriesLabel: "",
      locked: true,
    };
  }

  return {
    kind: cardKind(input),
    size: dimensions,
    title: truncateOnWord(input.question, MAX_CLAIM_CHARS),
    sideA: truncateOnWord(input.creatorPosition, MAX_SIDE_CHARS),
    sideB: truncateOnWord(input.counterPosition, MAX_SIDE_CHARS),
    sourceDomain: shareCardDomain(input.resolutionUrl),
    potLabel: `${formatPot(input.totalPot)} USDC`,
    modeLabel: policy?.label ?? "",
    economicsLabel: economicsLabel(input.mode.settlementMode),
    deadlineIso: input.deadline > 0 ? new Date(input.deadline * 1000).toISOString() : "",
    verdictLabel: verdictLabel(input),
    payoutLabel:
      input.state === "resolved" && typeof input.payout === "number" && input.payout > 0
        ? `${formatPot(input.payout)} USDC paid out`
        : "",
    seriesLabel: seriesLabel(input),
    locked: false,
  };
}

/** Compact pot formatting — the card has no room for six decimals. */
export function formatPot(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

/**
 * The public share URL. Only the claim id ever appears — never an invite key,
 * which would end up in CDN cache keys, referrer headers and access logs.
 */
export function shareCardPath(claimId: number, size: CardSize = "og"): string {
  return size === "og" ? `/api/share/${claimId}` : `/api/share/${claimId}?size=${size}`;
}

/** Detects an invite key smuggled into a share URL, for the guard test. */
export function shareUrlLeaksInviteKey(url: string): boolean {
  return /(invite|inviteKey|invite_key|pass|key)=/i.test(url);
}
