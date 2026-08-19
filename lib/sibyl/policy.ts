/**
 * Load-bearing rules over recalled Sibyl entities.
 *
 * These functions are pure so a judge can delete the database, re-run an
 * agent, and see the veto disappear. They never invent memory.
 */

export interface SourceMemory {
  host: string;
  evaluations: number;
  challenges: number;
  settlements: number;
  unresolvable: number;
  draws: number;
  creatorWins: number;
  challengersWin: number;
  lastVerdict: string | null;
  lastClaimId: number | null;
  lastAction: string | null;
  updatedAt: string;
}

export interface PersonaSourceMemory {
  host: string;
  evaluations: number;
  abstentions: number;
  stakes: number;
  lastVerdict: string | null;
  lastClaimId: number | null;
  updatedAt: string;
}

export interface MemoryGate {
  allow: boolean;
  adjustedConfidence: number;
  reason: string;
  veto: "none" | "unreliable-source" | "confidence-penalty" | "persona-source-abstain";
}

const UNRESOLVABLE_REFUSE_AT = 2;
const PENALTY_PER_UNRESOLVABLE = 8;
const PENALTY_PER_DRAW = 4;
const MAX_PENALTY = 30;
const PERSONA_ABSTAIN_REFUSE_AT = 2;

export function emptySource(host: string): SourceMemory {
  return {
    host,
    evaluations: 0,
    challenges: 0,
    settlements: 0,
    unresolvable: 0,
    draws: 0,
    creatorWins: 0,
    challengersWin: 0,
    lastVerdict: null,
    lastClaimId: null,
    lastAction: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function emptyPersonaSource(host: string): PersonaSourceMemory {
  return {
    host,
    evaluations: 0,
    abstentions: 0,
    stakes: 0,
    lastVerdict: null,
    lastClaimId: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function parseSourceMemory(body: unknown, fallbackHost: string): SourceMemory | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const host = typeof row.host === "string" && row.host ? row.host : fallbackHost;
  return {
    host,
    evaluations: num(row.evaluations),
    challenges: num(row.challenges),
    settlements: num(row.settlements),
    unresolvable: num(row.unresolvable),
    draws: num(row.draws),
    creatorWins: num(row.creatorWins),
    challengersWin: num(row.challengersWin),
    lastVerdict: typeof row.lastVerdict === "string" ? row.lastVerdict : null,
    lastClaimId: typeof row.lastClaimId === "number" ? row.lastClaimId : null,
    lastAction: typeof row.lastAction === "string" ? row.lastAction : null,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date(0).toISOString(),
  };
}

export function parsePersonaSourceMemory(
  body: unknown,
  fallbackHost: string,
): PersonaSourceMemory | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const host = typeof row.host === "string" && row.host ? row.host : fallbackHost;
  return {
    host,
    evaluations: num(row.evaluations),
    abstentions: num(row.abstentions),
    stakes: num(row.stakes),
    lastVerdict: typeof row.lastVerdict === "string" ? row.lastVerdict : null,
    lastClaimId: typeof row.lastClaimId === "number" ? row.lastClaimId : null,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date(0).toISOString(),
  };
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Source has produced more fog than decisive outcomes. */
export function sourceIsUnreliable(source: SourceMemory | null): boolean {
  if (!source) return false;
  const decisive = source.challengersWin + source.creatorWins;
  return source.unresolvable >= UNRESOLVABLE_REFUSE_AT && source.unresolvable >= decisive;
}

export function confidencePenalty(source: SourceMemory | null): number {
  if (!source) return 0;
  return Math.min(
    MAX_PENALTY,
    source.unresolvable * PENALTY_PER_UNRESOLVABLE + source.draws * PENALTY_PER_DRAW,
  );
}

export function applyChallengeMemory(input: {
  source: SourceMemory | null;
  verdict: string;
  confidence: number;
  minConfidence: number;
}): MemoryGate {
  if (sourceIsUnreliable(input.source)) {
    return {
      allow: false,
      adjustedConfidence: 0,
      veto: "unreliable-source",
      reason:
        `Sibyl memory veto: ${input.source!.host} has ${input.source!.unresolvable} ` +
        `unresolvable reads vs ${input.source!.challengersWin + input.source!.creatorWins} decisive`,
    };
  }
  const adjusted = Math.max(0, input.confidence - confidencePenalty(input.source));
  if (input.verdict !== "CHALLENGERS_WIN" || adjusted < input.minConfidence) {
    return {
      allow: false,
      adjustedConfidence: adjusted,
      veto: input.source && confidencePenalty(input.source) > 0 ? "confidence-penalty" : "none",
      reason:
        `Not staking after memory: verdict ${input.verdict} at ${adjusted}% ` +
        `(raw ${input.confidence}%, floor ${input.minConfidence}%)`,
    };
  }
  return {
    allow: true,
    adjustedConfidence: adjusted,
    veto: "none",
    reason: "Sibyl memory allows challenge",
  };
}

export function applyCreateMemory(source: SourceMemory | null): MemoryGate {
  if (sourceIsUnreliable(source)) {
    return {
      allow: false,
      adjustedConfidence: 0,
      veto: "unreliable-source",
      reason:
        `Sibyl memory veto: will not open a market on ${source!.host} ` +
        `(${source!.unresolvable} unresolvable reads)`,
    };
  }
  return {
    allow: true,
    adjustedConfidence: 100,
    veto: "none",
    reason: "Sibyl memory allows create",
  };
}

export function applyPersonaStakeMemory(input: {
  source: PersonaSourceMemory | null;
  wantsToStake: boolean;
  confidence?: number;
}): MemoryGate {
  const source = input.source;
  if (
    source &&
    source.abstentions >= PERSONA_ABSTAIN_REFUSE_AT &&
    source.stakes === 0
  ) {
    return {
      allow: false,
      adjustedConfidence: input.confidence ?? 0,
      veto: "persona-source-abstain",
      reason:
        `Sibyl memory veto: this persona already stood aside ${source.abstentions} ` +
        `times on ${source.host} and never staked there`,
    };
  }
  if (!input.wantsToStake) {
    return {
      allow: false,
      adjustedConfidence: input.confidence ?? 0,
      veto: "none",
      reason: "Persona did not want to stake",
    };
  }
  return {
    allow: true,
    adjustedConfidence: input.confidence ?? 0,
    veto: "none",
    reason: "Sibyl memory allows persona stake",
  };
}

export function recordSourceVerdict(
  previous: SourceMemory | null,
  host: string,
  update: {
    claimId: number;
    verdict?: string | null;
    action: string;
    increment?: Partial<
      Pick<
        SourceMemory,
        "evaluations" | "challenges" | "settlements" | "unresolvable" | "draws" | "creatorWins" | "challengersWin"
      >
    >;
  },
): SourceMemory {
  const next: SourceMemory = { ...(previous ?? emptySource(host)), host };
  const inc = update.increment ?? {};
  next.evaluations += inc.evaluations ?? 0;
  next.challenges += inc.challenges ?? 0;
  next.settlements += inc.settlements ?? 0;
  next.unresolvable += inc.unresolvable ?? 0;
  next.draws += inc.draws ?? 0;
  next.creatorWins += inc.creatorWins ?? 0;
  next.challengersWin += inc.challengersWin ?? 0;
  if (update.verdict !== undefined) next.lastVerdict = update.verdict;
  next.lastClaimId = update.claimId;
  next.lastAction = update.action;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function recordPersonaSource(
  previous: PersonaSourceMemory | null,
  host: string,
  update: {
    claimId: number;
    verdict?: string | null;
    abstained: boolean;
    staked: boolean;
  },
): PersonaSourceMemory {
  const next: PersonaSourceMemory = { ...(previous ?? emptyPersonaSource(host)), host };
  next.evaluations += 1;
  if (update.staked) next.stakes += 1;
  else if (update.abstained) next.abstentions += 1;
  if (update.verdict !== undefined) next.lastVerdict = update.verdict;
  next.lastClaimId = update.claimId;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function incrementsForVerdict(
  verdict: string,
): Pick<SourceMemory, "unresolvable" | "draws" | "creatorWins" | "challengersWin"> {
  return {
    unresolvable: verdict === "UNRESOLVABLE" ? 1 : 0,
    draws: verdict === "DRAW" ? 1 : 0,
    creatorWins: verdict === "CREATOR_WINS" ? 1 : 0,
    challengersWin: verdict === "CHALLENGERS_WIN" ? 1 : 0,
  };
}
