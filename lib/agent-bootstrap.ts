/**
 * Shared startup guards for the worker agents (oracle, market-creator, council).
 */

/** Exits the process when any required env var is missing. */
export function requireEnv(names: string[]): void {
  for (const v of names) {
    if (!process.env[v]) {
      console.error(`${v} env var is required`);
      process.exit(1);
    }
  }
}

const LLM_KEY_VARS = [
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "GROQ_API_KEYS",
  "OPENROUTER_API_KEY",
] as const;

/** Exits the process unless at least one LLM provider key is configured. */
export function requireAnyLLMKey(): void {
  if (!LLM_KEY_VARS.some((v) => process.env[v]?.trim())) {
    console.error(
      "Set at least one LLM key: GEMINI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY/GROQ_API_KEYS, or OPENROUTER_API_KEY",
    );
    process.exit(1);
  }
}

/**
 * Serializes LLM calls: consecutive invocations of the returned gate are at
 * least `ms` apart, so a burst of claims doesn't trip free-tier RPM limits.
 */
export function createThrottle(ms: number): () => Promise<void> {
  let nextAllowedAt = 0;
  let queue = Promise.resolve();
  return async () => {
    // Queue concurrent callers too. A timestamp-only gate lets simultaneous
    // calls pass together and defeats the RPM protection during bursts.
    const turn = queue.then(async () => {
      const wait = nextAllowedAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      nextAllowedAt = Date.now() + Math.max(0, ms);
    });
    queue = turn.catch(() => undefined);
    await turn;
  };
}

/**
 * Worker-scoped Gemini key: promotes e.g. ORACLE_GEMINI_API_KEY to
 * GEMINI_API_KEY for this process so each worker consumes from its own
 * free-tier RPM bucket. Trimmed on assignment so trailing whitespace pasted
 * into a dashboard env UI can't slip into the Authorization header.
 */
export function applyWorkerGeminiKey(envVar: string): void {
  const k = process.env[envVar]?.trim();
  if (k) {
    process.env.GEMINI_API_KEY = k;
    // Do not let a worker-scoped key fall back into the shared ring.
    process.env.GEMINI_WORKER_SCOPED = "1";
  }
}
