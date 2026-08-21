import {
  ensureSibyl,
  getEntity,
  setEntity,
  sibylRequired,
  SibylUnavailableError,
  writeEvent,
} from "./client";
import { archiveSibylMemoryEvent, archiveSibylMemorySnapshot } from "../db";
import {
  applyChallengeMemory,
  applyCreateMemory,
  applyPersonaStakeMemory,
  incrementsForVerdict,
  parsePersonaSourceMemory,
  parseSourceMemory,
  recordPersonaSource,
  recordSourceVerdict,
  type MemoryGate,
  type PersonaSourceMemory,
  type SourceMemory,
} from "./policy";
import { SOURCE_CATEGORY, sourceKeyFromUrl, TENANTS } from "./source-key";

export { TENANTS, sourceKeyFromUrl };
export type { MemoryGate, PersonaSourceMemory, SourceMemory };
export { SibylUnavailableError, ensureSibyl, sibylRequired, stopSibyl } from "./client";
export {
  applyChallengeMemory,
  applyCreateMemory,
  applyPersonaStakeMemory,
  confidencePenalty,
  sourceIsUnreliable,
} from "./policy";

const EVENT_LOG_ENABLED = process.env.SIBYL_EVENT_LOG !== "0";
let sibylEventWarningLogged = false;
let neonArchiveWarningLogged = false;
let sibylCapacityWarningLogged = false;

function isSibylCapacityError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("5 MB free-tier cap") || message.includes("free-tier cap");
}

async function archiveSnapshotBestEffort(
  tenant: string,
  name: string,
  body: unknown,
): Promise<void> {
  try {
    await archiveSibylMemorySnapshot({
      tenant,
      category: SOURCE_CATEGORY,
      name,
      body,
    });
  } catch (err) {
    if (!neonArchiveWarningLogged) {
      neonArchiveWarningLogged = true;
      console.warn("[sibyl] Neon snapshot archive unavailable; continuing with Sibyl:", err instanceof Error ? err.message : err);
    }
  }
}

async function saveEntityWithCapacityFallback(
  tenant: string,
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    await setEntity(tenant, SOURCE_CATEGORY, name, body);
  } catch (err) {
    if (!isSibylCapacityError(err)) throw err;
    // The existing COLD journal may already have filled the free tier. Keep the
    // last known-good WARM summary (it is safer than replacing it with nothing)
    // and rely on Neon snapshots until the operator activates/compacts Sibyl.
    if (!sibylCapacityWarningLogged) {
      sibylCapacityWarningLogged = true;
      console.warn("[sibyl] free-tier cap reached; keeping the last source summary and Neon snapshots");
    }
  }
}

async function persistEvent(
  tenant: string,
  event: { evaluated?: unknown; acted?: unknown; extra?: unknown },
): Promise<void> {
  let eventId: string | undefined;
  if (EVENT_LOG_ENABLED) {
    try {
      eventId = await writeEvent(tenant, event);
    } catch (err) {
      // Event history is optional. A full/temporarily unavailable COLD tier
      // must not block the load-bearing entity summary or an agent decision.
      if (!sibylEventWarningLogged) {
        sibylEventWarningLogged = true;
        console.warn("[sibyl] event history unavailable; continuing with entity memory:", err instanceof Error ? err.message : err);
      }
    }
  }

  try {
    await archiveSibylMemoryEvent({ eventId, tenant, ...event });
  } catch (err) {
    // Neon is the detailed archive, never the source of truth for the gate.
    if (!neonArchiveWarningLogged) {
      neonArchiveWarningLogged = true;
      console.warn("[sibyl] Neon archive unavailable; continuing with Sibyl entity memory:", err instanceof Error ? err.message : err);
    }
  }
}

export async function requireSibyl(): Promise<void> {
  try {
    await ensureSibyl();
  } catch (err) {
    if (sibylRequired()) throw err;
    console.warn("[sibyl] optional sidecar unavailable:", err instanceof Error ? err.message : err);
  }
}

export async function loadSource(tenant: string, url: string): Promise<SourceMemory | null> {
  const { host, key } = sourceKeyFromUrl(url);
  const entity = await getEntity(tenant, SOURCE_CATEGORY, key);
  return parseSourceMemory(entity?.body, host);
}

export async function saveSource(tenant: string, memory: SourceMemory): Promise<void> {
  const { key } = sourceKeyFromUrl(memory.host);
  await archiveSnapshotBestEffort(tenant, key, memory);
  await saveEntityWithCapacityFallback(tenant, key, { ...memory });
}

export async function loadPersonaSource(
  tenant: string,
  url: string,
): Promise<PersonaSourceMemory | null> {
  const { host, key } = sourceKeyFromUrl(url);
  const entity = await getEntity(tenant, SOURCE_CATEGORY, key);
  return parsePersonaSourceMemory(entity?.body, host);
}

export async function savePersonaSource(
  tenant: string,
  memory: PersonaSourceMemory,
): Promise<void> {
  const { key } = sourceKeyFromUrl(memory.host);
  await archiveSnapshotBestEffort(tenant, key, memory);
  await saveEntityWithCapacityFallback(tenant, key, { ...memory });
}

export async function rememberOracleEvaluation(input: {
  url: string;
  claimId: number;
  verdict: string;
  confidence: number;
  action: "evaluate" | "challenge" | "settle" | "veto";
}): Promise<SourceMemory> {
  const { host } = sourceKeyFromUrl(input.url);
  const previous = await loadSource(TENANTS.oracle, input.url);
  const buckets = incrementsForVerdict(input.verdict);
  const next = recordSourceVerdict(previous, host, {
    claimId: input.claimId,
    verdict: input.verdict,
    action: input.action,
    increment: {
      evaluations: 1,
      challenges: input.action === "challenge" ? 1 : 0,
      settlements: input.action === "settle" ? 1 : 0,
      ...buckets,
    },
  });
  await saveSource(TENANTS.oracle, next);
  await persistEvent(TENANTS.oracle, {
    evaluated: {
      claimId: input.claimId,
      host,
      verdict: input.verdict,
      confidence: input.confidence,
    },
    acted: [input.action],
    extra: next,
  });
  return next;
}

/** Persist a Virtuals ACP assessment in its own Sibyl tenant. */
export async function rememberVirtualsEvaluation(input: {
  url: string;
  jobId: string;
  verdict: string;
  decision: string;
  confidence: number;
  action: "evaluate" | "veto" | "error";
}): Promise<SourceMemory> {
  const { host } = sourceKeyFromUrl(input.url);
  const previous = await loadSource(TENANTS.virtuals, input.url);
  const next = recordSourceVerdict(previous, host, {
    claimId: Number.isSafeInteger(Number(input.jobId)) ? Number(input.jobId) : 0,
    verdict: input.verdict,
    action: `acp-${input.action}`,
    increment: {
      evaluations: 1,
      ...incrementsForVerdict(input.verdict),
    },
  });
  await saveSource(TENANTS.virtuals, next);
  await persistEvent(TENANTS.virtuals, {
    evaluated: {
      jobId: input.jobId,
      host,
      verdict: input.verdict,
      decision: input.decision,
      confidence: input.confidence,
    },
    acted: [input.action],
    extra: next,
  });
  return next;
}

export async function challengeGateForUrl(input: {
  url: string;
  verdict: string;
  confidence: number;
  minConfidence: number;
}): Promise<{ source: SourceMemory | null; gate: MemoryGate }> {
  const source = await loadSource(TENANTS.oracle, input.url);
  return {
    source,
    gate: applyChallengeMemory({
      source,
      verdict: input.verdict,
      confidence: input.confidence,
      minConfidence: input.minConfidence,
    }),
  };
}

export async function createGateForUrl(url: string): Promise<{ source: SourceMemory | null; gate: MemoryGate }> {
  const source = await loadSource(TENANTS.oracle, url);
  return { source, gate: applyCreateMemory(source) };
}

export async function rememberCreate(input: {
  url: string;
  question: string;
  allowed: boolean;
}): Promise<void> {
  const { host } = sourceKeyFromUrl(input.url);
  await persistEvent(TENANTS.creator, {
    evaluated: { host, question: input.question },
    acted: [input.allowed ? "create" : "skip-create"],
  });
  if (!input.allowed) return;
  const previous = await loadSource(TENANTS.creator, input.url);
  const next = recordSourceVerdict(previous, host, {
    claimId: 0,
    action: "create",
    increment: { evaluations: 1 },
  });
  await saveSource(TENANTS.creator, next);
}

export async function personaStakeGateForUrl(input: {
  slug: string;
  url: string;
  wantsToStake: boolean;
  confidence?: number;
}): Promise<{ source: PersonaSourceMemory | null; gate: MemoryGate }> {
  const tenant = TENANTS.council(input.slug);
  const source = await loadPersonaSource(tenant, input.url);
  return {
    source,
    gate: applyPersonaStakeMemory({
      source,
      wantsToStake: input.wantsToStake,
      confidence: input.confidence,
    }),
  };
}

export async function rememberPersonaDecision(input: {
  slug: string;
  url: string;
  claimId: number;
  verdict?: string | null;
  staked: boolean;
  abstained: boolean;
}): Promise<PersonaSourceMemory> {
  const tenant = TENANTS.council(input.slug);
  const { host } = sourceKeyFromUrl(input.url);
  const previous = await loadPersonaSource(tenant, input.url);
  const next = recordPersonaSource(previous, host, {
    claimId: input.claimId,
    verdict: input.verdict,
    abstained: input.abstained,
    staked: input.staked,
  });
  await savePersonaSource(tenant, next);
  await persistEvent(tenant, {
    evaluated: { claimId: input.claimId, host, verdict: input.verdict ?? null },
    acted: [input.staked ? "stake" : "abstain"],
    extra: next,
  });
  return next;
}

export async function traderStakeGateForUrl(input: {
  agentId: string;
  url: string;
  wantsToStake: boolean;
  confidence?: number;
}): Promise<{ source: PersonaSourceMemory | null; gate: MemoryGate }> {
  const tenant = TENANTS.trader(input.agentId);
  const source = await loadPersonaSource(tenant, input.url);
  return {
    source,
    gate: applyPersonaStakeMemory({
      source,
      wantsToStake: input.wantsToStake,
      confidence: input.confidence,
    }),
  };
}

export async function rememberTraderDecision(input: {
  agentId: string;
  url: string;
  claimId: number;
  verdict?: string | null;
  staked: boolean;
  abstained: boolean;
}): Promise<PersonaSourceMemory> {
  const tenant = TENANTS.trader(input.agentId);
  const { host } = sourceKeyFromUrl(input.url);
  const previous = await loadPersonaSource(tenant, input.url);
  const next = recordPersonaSource(previous, host, {
    claimId: input.claimId,
    verdict: input.verdict,
    abstained: input.abstained,
    staked: input.staked,
  });
  await savePersonaSource(tenant, next);
  await persistEvent(tenant, {
    evaluated: { claimId: input.claimId, host, verdict: input.verdict ?? null },
    acted: [input.staked ? "stake" : "abstain"],
    extra: next,
  });
  return next;
}
