import { Pool, neonConfig, type PoolConfig } from "@neondatabase/serverless";
import ws from "ws";

import type { ChallengeOpportunity } from "@/lib/claimDrafts";
import type { ClaimChallenger, ClaimData } from "@/lib/contract";

// Neon's @neondatabase/serverless uses WebSockets in Node — wire up the ws
// implementation. In edge/serverless runtimes that don't ship a global
// WebSocket, this is a no-op fallback (Vercel edge has its own native WS).
if (typeof globalThis.WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
}

export interface ClaimRow {
  id: number;
  creator: string;
  question: string | null;
  creator_position: string | null;
  counter_position: string | null;
  resolution_url: string | null;
  creator_stake: number;
  total_challenger_stake: number;
  reserved_creator_liability: number;
  deadline: number;
  state: string;
  winner_side: string;
  resolution_summary: string | null;
  confidence: number;
  category: string;
  parent_id: number;
  market_type: string;
  odds_mode: string;
  challenger_payout_bps: number;
  handicap_line: string | null;
  settlement_rule: string | null;
  max_challengers: number;
  visibility: string;
  challenger_count: number;
  total_pot: number;
  first_challenger: string;
  first_indexed_at: number;
  updated_at: number;
  is_final: number;
}

export interface ChallengerRow {
  claim_id: number;
  address: string;
  stake: number;
  potential_payout: number;
}

export interface ClaimFilters {
  ids?: number[];
  creator?: string;
  categories?: string[];
  states?: string[];
  parentId?: number;
  visibility?: string;
  isFinal?: boolean;
  limit?: number;
  orderBy?: "id_desc" | "updated_desc" | "deadline_asc" | "deadline_desc";
}

export interface ChallengeOpportunityRow {
  locale: string;
  id: string;
  source_url: string;
  source_type: string;
  source_summary: string;
  category: string;
  claim_text: string;
  side_a: string;
  side_b: string;
  deadline_at: string;
  timezone: string;
  primary_resolution_source: string;
  settlement_rule: string;
  ambiguity_flags_json: string;
  confidence_score: number;
  claim_strength_score: number;
  claim_strength_tier: string;
  action: string;
  existing_claim_id: number | null;
  generated_at: number;
  expires_at: number;
}

type IndexedClaimRecord = Omit<
  ClaimRow,
  "first_indexed_at" | "updated_at" | "is_final"
>;

const PRIVATE_CONTENT_FIELDS = [
  "question",
  "creator_position",
  "counter_position",
  "resolution_url",
  "resolution_summary",
  "handicap_line",
  "settlement_rule",
] as const;

interface SqlStatement {
  sql:   string;
  args?: ReadonlyArray<unknown>;
}

/**
 * Postgres schema. BIGINT for any value that could exceed 2^31 (stakes, deadlines).
 * On-conflict syntax is identical to SQLite since Postgres 9.5.
 */
const SCHEMA_STATEMENTS: SqlStatement[] = [
  { sql: `CREATE TABLE IF NOT EXISTS claims (
    id BIGINT PRIMARY KEY,
    creator TEXT NOT NULL,
    question TEXT,
    creator_position TEXT,
    counter_position TEXT,
    resolution_url TEXT,
    creator_stake NUMERIC NOT NULL DEFAULT 0,
    total_challenger_stake NUMERIC NOT NULL DEFAULT 0,
    reserved_creator_liability NUMERIC NOT NULL DEFAULT 0,
    deadline BIGINT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    winner_side TEXT NOT NULL DEFAULT '',
    resolution_summary TEXT,
    confidence INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'custom',
    parent_id BIGINT NOT NULL DEFAULT 0,
    market_type TEXT NOT NULL DEFAULT 'binary',
    odds_mode TEXT NOT NULL DEFAULT 'pool',
    challenger_payout_bps BIGINT NOT NULL DEFAULT 0,
    handicap_line TEXT,
    settlement_rule TEXT,
    max_challengers BIGINT NOT NULL DEFAULT 0,
    visibility TEXT NOT NULL DEFAULT 'public',
    challenger_count BIGINT NOT NULL DEFAULT 0,
    total_pot NUMERIC NOT NULL DEFAULT 0,
    first_challenger TEXT NOT NULL DEFAULT '',
    first_indexed_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0,
    is_final INTEGER NOT NULL DEFAULT 0
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_state ON claims(state)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_category ON claims(category)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_creator ON claims(creator)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_deadline ON claims(deadline)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_parent ON claims(parent_id)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_visibility ON claims(visibility)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_active ON claims(state, is_final)" },
  { sql: `CREATE TABLE IF NOT EXISTS challengers (
    claim_id BIGINT NOT NULL,
    address TEXT NOT NULL,
    stake NUMERIC NOT NULL DEFAULT 0,
    potential_payout NUMERIC NOT NULL DEFAULT 0,
    PRIMARY KEY (claim_id, address)
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_challengers_address ON challengers(address)" },
  // Stakes/payouts are USDC decimals (e.g. 5.53), not whole numbers — BIGINT
  // columns rejected every fractional write, silently dropping challenger
  // rows (upsertChallengers wraps delete+inserts in one transaction, so a
  // single fractional stake rolled the whole claim's challenger list back).
  // Migrate pre-existing deployments that still have the BIGINT columns.
  { sql: "ALTER TABLE claims ALTER COLUMN creator_stake TYPE NUMERIC" },
  { sql: "ALTER TABLE claims ALTER COLUMN total_challenger_stake TYPE NUMERIC" },
  { sql: "ALTER TABLE claims ALTER COLUMN reserved_creator_liability TYPE NUMERIC" },
  { sql: "ALTER TABLE claims ALTER COLUMN total_pot TYPE NUMERIC" },
  { sql: "ALTER TABLE challengers ALTER COLUMN stake TYPE NUMERIC" },
  { sql: "ALTER TABLE challengers ALTER COLUMN potential_payout TYPE NUMERIC" },
  { sql: `CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )` },
  { sql: `CREATE TABLE IF NOT EXISTS challenge_opportunities (
    locale TEXT NOT NULL,
    id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_summary TEXT NOT NULL,
    category TEXT NOT NULL,
    claim_text TEXT NOT NULL,
    side_a TEXT NOT NULL,
    side_b TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    primary_resolution_source TEXT NOT NULL,
    settlement_rule TEXT NOT NULL,
    ambiguity_flags_json TEXT NOT NULL DEFAULT '[]',
    confidence_score INTEGER NOT NULL DEFAULT 0,
    claim_strength_score INTEGER NOT NULL DEFAULT 0,
    claim_strength_tier TEXT NOT NULL DEFAULT 'weak',
    action TEXT NOT NULL DEFAULT 'create',
    existing_claim_id BIGINT,
    generated_at BIGINT NOT NULL DEFAULT 0,
    expires_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (locale, id)
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_challenge_opportunities_locale ON challenge_opportunities(locale)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_challenge_opportunities_expires_at ON challenge_opportunities(expires_at)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_challenge_opportunities_action ON challenge_opportunities(action)" },
  // Append-only agent reasoning log. A reasoning event is a claim about what an
  // agent believed at a point in time, so rows are never rewritten: corrections
  // are new events and withdrawals set tombstoned_at, keeping the audit trail.
  { sql: `CREATE TABLE IF NOT EXISTS agent_reasoning_events (
    event_id TEXT PRIMARY KEY,
    schema_version SMALLINT NOT NULL DEFAULT 1,
    claim_id BIGINT NOT NULL,
    agent_id TEXT NOT NULL,
    track TEXT NOT NULL,
    stage TEXT NOT NULL,
    position TEXT NOT NULL,
    confidence_bps INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL,
    uncertainty TEXT NOT NULL DEFAULT '',
    evidence_refs_json TEXT NOT NULL DEFAULT '[]',
    model TEXT,
    provider TEXT,
    prompt_version INTEGER,
    payment_identifier TEXT,
    visibility TEXT NOT NULL DEFAULT 'public',
    safety_findings_json TEXT NOT NULL DEFAULT '[]',
    created_at BIGINT NOT NULL DEFAULT 0,
    tombstoned_at BIGINT,
    tombstone_reason TEXT
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_reasoning_claim ON agent_reasoning_events(claim_id, created_at)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_reasoning_agent ON agent_reasoning_events(agent_id)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_reasoning_track ON agent_reasoning_events(track)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_reasoning_visibility ON agent_reasoning_events(visibility)" },
  // x402 settlement ledger. Amounts are ATOMIC token units, never floats — a
  // DOUBLE PRECISION column cannot hold 6dp money without rounding drift, and
  // SUM() over it compounds it. The old float `payments` table is deliberately
  // not migrated: revenue restarts from zero on Base Sepolia USDC.
  { sql: `CREATE TABLE IF NOT EXISTS payments_v2 (
    id BIGSERIAL PRIMARY KEY,
    resource TEXT NOT NULL,
    scheme TEXT NOT NULL DEFAULT 'exact',
    network TEXT NOT NULL,
    asset_address TEXT NOT NULL,
    asset_symbol TEXT NOT NULL DEFAULT 'USDC',
    asset_decimals SMALLINT NOT NULL DEFAULT 6,
    amount_atomic NUMERIC(78,0) NOT NULL,
    payer TEXT,
    seller TEXT,
    transaction_hash TEXT,
    payment_identifier TEXT NOT NULL,
    facilitator TEXT,
    settled_at BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0
  )` },
  // One row per x402 authorization: a retried settle must not double-count.
  { sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_v2_identifier ON payments_v2(network, payment_identifier)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_payments_v2_settled_at ON payments_v2(settled_at DESC)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_payments_v2_resource ON payments_v2(resource)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_payments_v2_seller ON payments_v2(seller)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_payments_v2_tx ON payments_v2(network, transaction_hash, resource)" },
  // Rebuildable read-index for MimirV2 fee events. Every monetary value stays
  // in atomic USDC units; transaction hash + log index makes replay idempotent.
  { sql: `CREATE TABLE IF NOT EXISTS fee_policies (
    policy_id TEXT PRIMARY KEY,
    platform_fee_bps INTEGER NOT NULL,
    agent_owner_fee_bps INTEGER NOT NULL,
    platform_recipient TEXT NOT NULL,
    effective_at BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    UNIQUE(transaction_hash, log_index)
  )` },
  { sql: `CREATE TABLE IF NOT EXISTS fee_accruals (
    accrual_id TEXT PRIMARY KEY,
    claim_id BIGINT NOT NULL,
    recipient TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('platform', 'agent_owner')),
    amount_atomic NUMERIC(78,0) NOT NULL,
    claimed_atomic NUMERIC(78,0) NOT NULL DEFAULT 0,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    accrued_at BIGINT NOT NULL,
    UNIQUE(transaction_hash, log_index)
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_fee_accruals_recipient ON fee_accruals(recipient)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_fee_accruals_claim ON fee_accruals(claim_id)" },
  { sql: `CREATE TABLE IF NOT EXISTS fee_claims (
    claim_event_id TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    amount_atomic NUMERIC(78,0) NOT NULL,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    claimed_at BIGINT NOT NULL,
    UNIQUE(transaction_hash, log_index)
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_fee_claims_recipient ON fee_claims(recipient)" },
  { sql: `CREATE TABLE IF NOT EXISTS agent_revenue_attribution (
    claim_id BIGINT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    owner_fee_recipient TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    attributed_at BIGINT NOT NULL,
    UNIQUE(transaction_hash, log_index)
  )` },
  { sql: `CREATE TABLE IF NOT EXISTS market_settlements (
    claim_id BIGINT PRIMARY KEY,
    gross_volume_atomic NUMERIC(78,0) NOT NULL,
    payout_atomic NUMERIC(78,0) NOT NULL,
    platform_fee_atomic NUMERIC(78,0) NOT NULL,
    agent_owner_fee_atomic NUMERIC(78,0) NOT NULL,
    dust_atomic NUMERIC(78,0) NOT NULL,
    transaction_hash TEXT NOT NULL UNIQUE,
    settled_at BIGINT NOT NULL
  )` },
  /**
   * Market-creator proposals, in the canonical mode schema (§10.4).
   *
   * Off-chain metadata, not a read-index projection: a proposal is a record of what
   * the creator DECIDED, including the ones it chose not to publish, which by
   * definition never reach the chain and so cannot be rebuilt from it. Keeping them
   * is the only way to measure shadow-mode precision against human review before
   * autonomous publishing is switched on.
   */
  { sql: `CREATE TABLE IF NOT EXISTS market_proposals (
    proposal_id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    question TEXT NOT NULL,
    creator_position TEXT NOT NULL,
    counter_position TEXT NOT NULL,
    category TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    settlement_mode TEXT NOT NULL,
    product_modifiers TEXT NOT NULL DEFAULT '[]',
    mode_rationale TEXT NOT NULL DEFAULT '',
    stake_policy TEXT NOT NULL DEFAULT '{}',
    context_pack_hash TEXT,
    resolution_url TEXT NOT NULL DEFAULT '',
    settlement_rule TEXT NOT NULL DEFAULT '',
    deadline BIGINT NOT NULL DEFAULT 0,
    quality_score INTEGER NOT NULL DEFAULT 0,
    preflight_verdict TEXT NOT NULL DEFAULT '{}',
    disposition TEXT NOT NULL,
    blocked_by TEXT,
    /** Set when the proposal was actually published. */
    claim_id BIGINT,
    /** Human review outcome, filled in later: agree | disagree | unreviewed. */
    review TEXT NOT NULL DEFAULT 'unreviewed'
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_market_proposals_created ON market_proposals(created_at DESC)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_market_proposals_disposition ON market_proposals(disposition)" },
  {
    sql: "INSERT INTO sync_meta(key, value) VALUES($1, $2) ON CONFLICT(key) DO NOTHING",
    args: ["last_claim_count", "0"],
  },
  {
    sql: "INSERT INTO sync_meta(key, value) VALUES($1, $2) ON CONFLICT(key) DO NOTHING",
    args: ["last_sync_at", "0"],
  },
];

declare global {
  // eslint-disable-next-line no-var
  var __mimirDbPool:  Pool | undefined;
  // eslint-disable-next-line no-var
  var __mimirDbReady: Promise<Pool> | undefined;
}

export function isDbConfigured(): boolean {
  return Boolean((process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL)?.trim());
}

function getDbConnectionString(): string {
  const url = (process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL)?.trim();
  if (!url) throw new Error("DATABASE_URL is not configured");
  return url;
}

function buildPool(): Pool {
  const cfg: PoolConfig = { connectionString: getDbConnectionString() };
  return new Pool(cfg);
}

/** Convert `?` placeholders to Postgres `$1, $2, ...` in source order. */
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function execute(
  pool: Pool,
  stmt: SqlStatement,
): Promise<{ rows: Array<Record<string, unknown>> }> {
  const args = stmt.args ?? [];
  const sql = stmt.sql.includes("$") ? stmt.sql : toPg(stmt.sql);
  const result = await pool.query(sql, args as unknown[]);
  return { rows: result.rows as Array<Record<string, unknown>> };
}

async function ensureSchema(pool: Pool): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await execute(pool, stmt);
  }
}

async function batchWrite(pool: Pool, statements: SqlStatement[]): Promise<void> {
  if (statements.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const stmt of statements) {
      const sql = stmt.sql.includes("$") ? stmt.sql : toPg(stmt.sql);
      await client.query(sql, (stmt.args ?? []) as unknown[]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function getNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.length > 0) return Number(value);
  return 0;
}

function getString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function getNullableString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function normalizeClaimRow(row: Record<string, unknown>): ClaimRow {
  return {
    id: getNumber(row.id),
    creator: getString(row.creator),
    question: getNullableString(row.question),
    creator_position: getNullableString(row.creator_position),
    counter_position: getNullableString(row.counter_position),
    resolution_url: getNullableString(row.resolution_url),
    creator_stake: getNumber(row.creator_stake),
    total_challenger_stake: getNumber(row.total_challenger_stake),
    reserved_creator_liability: getNumber(row.reserved_creator_liability),
    deadline: getNumber(row.deadline),
    state: getString(row.state),
    winner_side: getString(row.winner_side),
    resolution_summary: getNullableString(row.resolution_summary),
    confidence: getNumber(row.confidence),
    category: getString(row.category),
    parent_id: getNumber(row.parent_id),
    market_type: getString(row.market_type),
    odds_mode: getString(row.odds_mode),
    challenger_payout_bps: getNumber(row.challenger_payout_bps),
    handicap_line: getNullableString(row.handicap_line),
    settlement_rule: getNullableString(row.settlement_rule),
    max_challengers: getNumber(row.max_challengers),
    visibility: getString(row.visibility),
    challenger_count: getNumber(row.challenger_count),
    total_pot: getNumber(row.total_pot),
    first_challenger: getString(row.first_challenger),
    first_indexed_at: getNumber(row.first_indexed_at),
    updated_at: getNumber(row.updated_at),
    is_final: getNumber(row.is_final),
  };
}

function normalizeChallengerRow(row: Record<string, unknown>): ChallengerRow {
  return {
    claim_id: getNumber(row.claim_id),
    address: getString(row.address),
    stake: getNumber(row.stake),
    potential_payout: getNumber(row.potential_payout),
  };
}

function normalizeChallengeOpportunityRow(
  row: Record<string, unknown>
): ChallengeOpportunityRow {
  return {
    locale: getString(row.locale),
    id: getString(row.id),
    source_url: getString(row.source_url),
    source_type: getString(row.source_type),
    source_summary: getString(row.source_summary),
    category: getString(row.category),
    claim_text: getString(row.claim_text),
    side_a: getString(row.side_a),
    side_b: getString(row.side_b),
    deadline_at: getString(row.deadline_at),
    timezone: getString(row.timezone),
    primary_resolution_source: getString(row.primary_resolution_source),
    settlement_rule: getString(row.settlement_rule),
    ambiguity_flags_json: getString(row.ambiguity_flags_json),
    confidence_score: getNumber(row.confidence_score),
    claim_strength_score: getNumber(row.claim_strength_score),
    claim_strength_tier: getString(row.claim_strength_tier),
    action: getString(row.action),
    existing_claim_id:
      row.existing_claim_id == null ? null : getNumber(row.existing_claim_id),
    generated_at: getNumber(row.generated_at),
    expires_at: getNumber(row.expires_at),
  };
}

function buildIndexedClaimRecord(claim: ClaimData): IndexedClaimRecord {
  const visibility = claim.visibility ?? (claim.is_private ? "private" : "public");
  const isPrivate = visibility === "private" || Boolean(claim.is_private);

  const content: Record<(typeof PRIVATE_CONTENT_FIELDS)[number], string | null> = {
    question: claim.question,
    creator_position: claim.creator_position,
    counter_position: claim.counter_position,
    resolution_url: claim.resolution_url,
    resolution_summary: claim.resolution_summary,
    handicap_line: claim.handicap_line,
    settlement_rule: claim.settlement_rule,
  };

  if (isPrivate) {
    for (const field of PRIVATE_CONTENT_FIELDS) {
      content[field] = null;
    }
  }

  return {
    id: claim.id,
    creator: claim.creator.toLowerCase(),
    question: content.question,
    creator_position: content.creator_position,
    counter_position: content.counter_position,
    resolution_url: content.resolution_url,
    creator_stake: claim.creator_stake,
    total_challenger_stake: claim.total_challenger_stake,
    reserved_creator_liability: claim.reserved_creator_liability,
    deadline: claim.deadline,
    state: claim.state,
    winner_side: claim.winner_side,
    resolution_summary: content.resolution_summary,
    confidence: claim.confidence,
    category: claim.category,
    parent_id: claim.parent_id,
    market_type: claim.market_type,
    odds_mode: claim.odds_mode,
    challenger_payout_bps: claim.challenger_payout_bps,
    handicap_line: content.handicap_line,
    settlement_rule: content.settlement_rule,
    max_challengers: claim.max_challengers,
    visibility,
    challenger_count: claim.challenger_count,
    total_pot: claim.total_pot,
    first_challenger:
      (claim.first_challenger ?? claim.challenger_addresses?.[0] ?? "").toLowerCase(),
  };
}

function buildClaimUpsertStatement(claim: ClaimData, timestamp: number): SqlStatement {
  const record = buildIndexedClaimRecord(claim);
  return {
    sql: `INSERT INTO claims (
      id, creator, question, creator_position, counter_position, resolution_url,
      creator_stake, total_challenger_stake, reserved_creator_liability,
      deadline, state, winner_side, resolution_summary, confidence, category,
      parent_id, market_type, odds_mode, challenger_payout_bps, handicap_line,
      settlement_rule, max_challengers, visibility, challenger_count, total_pot,
      first_challenger, first_indexed_at, updated_at, is_final
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      creator = excluded.creator,
      question = excluded.question,
      creator_position = excluded.creator_position,
      counter_position = excluded.counter_position,
      resolution_url = excluded.resolution_url,
      creator_stake = excluded.creator_stake,
      total_challenger_stake = excluded.total_challenger_stake,
      reserved_creator_liability = excluded.reserved_creator_liability,
      deadline = excluded.deadline,
      state = excluded.state,
      winner_side = excluded.winner_side,
      resolution_summary = excluded.resolution_summary,
      confidence = excluded.confidence,
      category = excluded.category,
      parent_id = excluded.parent_id,
      market_type = excluded.market_type,
      odds_mode = excluded.odds_mode,
      challenger_payout_bps = excluded.challenger_payout_bps,
      handicap_line = excluded.handicap_line,
      settlement_rule = excluded.settlement_rule,
      max_challengers = excluded.max_challengers,
      visibility = excluded.visibility,
      challenger_count = excluded.challenger_count,
      total_pot = excluded.total_pot,
      first_challenger = excluded.first_challenger,
      first_indexed_at = CASE
        WHEN claims.first_indexed_at > 0 THEN claims.first_indexed_at
        ELSE excluded.first_indexed_at
      END,
      updated_at = excluded.updated_at,
      is_final = excluded.is_final`,
    args: [
      record.id,
      record.creator,
      record.question,
      record.creator_position,
      record.counter_position,
      record.resolution_url,
      record.creator_stake,
      record.total_challenger_stake,
      record.reserved_creator_liability,
      record.deadline,
      record.state,
      record.winner_side,
      record.resolution_summary,
      record.confidence,
      record.category,
      record.parent_id,
      record.market_type,
      record.odds_mode,
      record.challenger_payout_bps,
      record.handicap_line,
      record.settlement_rule,
      record.max_challengers,
      record.visibility,
      record.challenger_count,
      record.total_pot,
      record.first_challenger,
      timestamp,
      timestamp,
      record.state === "resolved" || record.state === "cancelled" ? 1 : 0,
    ],
  };
}

function makeListPlaceholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

export function getPrivateClaimFields(): string[] {
  return [...PRIVATE_CONTENT_FIELDS];
}

export async function getDb(): Promise<Pool> {
  if (!isDbConfigured()) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!globalThis.__mimirDbPool) {
    globalThis.__mimirDbPool = buildPool();
  }
  if (!globalThis.__mimirDbReady) {
    globalThis.__mimirDbReady = ensureSchema(globalThis.__mimirDbPool).then(
      () => globalThis.__mimirDbPool as Pool,
    );
  }
  return globalThis.__mimirDbReady;
}

export async function upsertClaim(claim: ClaimData): Promise<void> {
  const pool = await getDb();
  await execute(pool, buildClaimUpsertStatement(claim, Date.now()));
}

export async function upsertClaimsBatch(claims: ClaimData[]): Promise<void> {
  if (claims.length === 0) return;
  const pool = await getDb();
  const now = Date.now();
  await batchWrite(pool, claims.map((claim) => buildClaimUpsertStatement(claim, now)));
}

export async function getClaimById(id: number): Promise<ClaimRow | null> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql:  "SELECT * FROM claims WHERE id = ? LIMIT 1",
    args: [id],
  });
  const row = result.rows[0];
  return row ? normalizeClaimRow(row as Record<string, unknown>) : null;
}

export async function getClaimsByFilter(filters: ClaimFilters = {}): Promise<ClaimRow[]> {
  const pool = await getDb();
  const clauses: string[] = [];
  const args: Array<string | number> = [];

  if (filters.ids && filters.ids.length > 0) {
    clauses.push(`id IN (${makeListPlaceholders(filters.ids)})`);
    args.push(...filters.ids);
  }
  if (filters.creator) {
    clauses.push("creator = ?");
    args.push(filters.creator);
  }
  if (filters.categories && filters.categories.length > 0) {
    clauses.push(`category IN (${makeListPlaceholders(filters.categories)})`);
    args.push(...filters.categories);
  }
  if (filters.states && filters.states.length > 0) {
    clauses.push(`state IN (${makeListPlaceholders(filters.states)})`);
    args.push(...filters.states);
  }
  if (typeof filters.parentId === "number") {
    clauses.push("parent_id = ?");
    args.push(filters.parentId);
  }
  if (filters.visibility) {
    clauses.push("visibility = ?");
    args.push(filters.visibility);
  }
  if (typeof filters.isFinal === "boolean") {
    clauses.push("is_final = ?");
    args.push(filters.isFinal ? 1 : 0);
  }

  let orderBy = "ORDER BY id DESC";
  switch (filters.orderBy) {
    case "updated_desc":
      orderBy = "ORDER BY updated_at DESC, id DESC";
      break;
    case "deadline_asc":
      orderBy = "ORDER BY deadline ASC, id DESC";
      break;
    case "deadline_desc":
      orderBy = "ORDER BY deadline DESC, id DESC";
      break;
    case "id_desc":
    default:
      orderBy = "ORDER BY id DESC";
      break;
  }

  const limitClause =
    typeof filters.limit === "number" && filters.limit > 0 ? " LIMIT ?" : "";
  if (limitClause) {
    args.push(filters.limit as number);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await execute(pool, {
    sql:  `SELECT * FROM claims ${whereClause} ${orderBy}${limitClause}`,
    args,
  });
  return result.rows.map((row) => normalizeClaimRow(row as Record<string, unknown>));
}

export async function getOpenClaims(): Promise<ClaimRow[]> {
  return getClaimsByFilter({
    states: ["open", "active"],
    visibility: "public",
    orderBy: "deadline_asc",
  });
}

export async function getRecentlyResolved(limit: number): Promise<ClaimRow[]> {
  return getClaimsByFilter({
    states: ["resolved"],
    visibility: "public",
    orderBy: "updated_desc",
    limit,
  });
}

export async function getExpiringClaims(withinSeconds: number): Promise<ClaimRow[]> {
  const pool = await getDb();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const result = await execute(pool, {
    sql: `SELECT * FROM claims
      WHERE visibility = ?
        AND is_final = 0
        AND state IN (?, ?)
        AND deadline >= ?
        AND deadline <= ?
      ORDER BY deadline ASC, id DESC`,
    args: ["public", "open", "active", nowSeconds, nowSeconds + withinSeconds],
  });
  return result.rows.map((row) => normalizeClaimRow(row as Record<string, unknown>));
}

/**
 * Markets whose deadline has passed and that are still unsettled.
 *
 * Two numbers, not one: a large backlog cleared promptly and a single ancient
 * stuck market are different failures wanting different responses. The age is
 * taken from the OLDEST overdue market rather than an average over settled ones,
 * because an average improves precisely when settlement is stuck.
 */
export async function getSettlementBacklog(
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ count: number; oldestOverdueSec: number }> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql: `SELECT COUNT(*) AS overdue, MIN(deadline) AS oldest
      FROM claims
      WHERE is_final = 0
        AND state IN (?, ?)
        AND deadline < ?`,
    args: ["open", "active", nowSeconds],
  });
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  const count = Number(row.overdue ?? 0);
  const oldest = row.oldest === null || row.oldest === undefined ? null : Number(row.oldest);
  return {
    count: Number.isFinite(count) ? count : 0,
    oldestOverdueSec: oldest === null ? 0 : Math.max(0, nowSeconds - oldest),
  };
}

export async function getClaimsByParent(parentId: number): Promise<ClaimRow[]> {
  return getClaimsByFilter({
    parentId,
    orderBy: "id_desc",
  });
}

export async function getClaimFreshness(id: number): Promise<{ updated_at: number; is_final: number } | null> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql:  "SELECT updated_at, is_final FROM claims WHERE id = ? LIMIT 1",
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    updated_at: getNumber((row as Record<string, unknown>).updated_at),
    is_final:   getNumber((row as Record<string, unknown>).is_final),
  };
}

export async function upsertChallengers(
  claimId: number,
  challengers: ClaimChallenger[],
): Promise<void> {
  const pool = await getDb();
  const statements: SqlStatement[] = [
    {
      sql:  "DELETE FROM challengers WHERE claim_id = ?",
      args: [claimId],
    },
    ...challengers.map((challenger) => ({
      sql: `INSERT INTO challengers(claim_id, address, stake, potential_payout)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(claim_id, address) DO UPDATE SET
          stake = excluded.stake,
          potential_payout = excluded.potential_payout`,
      args: [
        claimId,
        challenger.address.toLowerCase(),
        challenger.stake,
        challenger.potential_payout,
      ],
    })),
  ];
  await batchWrite(pool, statements);
}

export async function getChallengersByClaimId(claimId: number): Promise<ChallengerRow[]> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql:  "SELECT * FROM challengers WHERE claim_id = ? ORDER BY address ASC",
    args: [claimId],
  });
  return result.rows.map((row) => normalizeChallengerRow(row as Record<string, unknown>));
}

export async function getClaimsByChallenger(address: string): Promise<number[]> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql:  "SELECT claim_id FROM challengers WHERE address = ? ORDER BY claim_id DESC",
    args: [address],
  });
  return result.rows.map((row) => getNumber((row as Record<string, unknown>).claim_id));
}

export async function getSyncMeta(key: string): Promise<string | null> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql:  "SELECT value FROM sync_meta WHERE key = ? LIMIT 1",
    args: [key],
  });
  const row = result.rows[0];
  return row ? getString((row as Record<string, unknown>).value) : null;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql: `INSERT INTO sync_meta(key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  });
}

function buildChallengeOpportunityInsertStatement(args: {
  locale: string;
  opportunity: ChallengeOpportunity;
  generatedAt: number;
  expiresAt: number;
}): SqlStatement {
  return {
    sql: `INSERT INTO challenge_opportunities (
      locale, id, source_url, source_type, source_summary, category, claim_text,
      side_a, side_b, deadline_at, timezone, primary_resolution_source,
      settlement_rule, ambiguity_flags_json, confidence_score, claim_strength_score,
      claim_strength_tier, action, existing_claim_id, generated_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(locale, id) DO UPDATE SET
      source_url = excluded.source_url,
      source_type = excluded.source_type,
      source_summary = excluded.source_summary,
      category = excluded.category,
      claim_text = excluded.claim_text,
      side_a = excluded.side_a,
      side_b = excluded.side_b,
      deadline_at = excluded.deadline_at,
      timezone = excluded.timezone,
      primary_resolution_source = excluded.primary_resolution_source,
      settlement_rule = excluded.settlement_rule,
      ambiguity_flags_json = excluded.ambiguity_flags_json,
      confidence_score = excluded.confidence_score,
      claim_strength_score = excluded.claim_strength_score,
      claim_strength_tier = excluded.claim_strength_tier,
      action = excluded.action,
      existing_claim_id = excluded.existing_claim_id,
      generated_at = excluded.generated_at,
      expires_at = excluded.expires_at`,
    args: [
      args.locale,
      args.opportunity.id,
      args.opportunity.sourceUrl,
      args.opportunity.sourceType,
      args.opportunity.sourceSummary,
      args.opportunity.candidate.category,
      args.opportunity.candidate.claimText,
      args.opportunity.candidate.sideA,
      args.opportunity.candidate.sideB,
      args.opportunity.candidate.deadlineAt,
      args.opportunity.candidate.timezone,
      args.opportunity.candidate.primaryResolutionSource,
      args.opportunity.candidate.settlementRule,
      JSON.stringify(args.opportunity.candidate.ambiguityFlags ?? []),
      args.opportunity.candidate.confidenceScore,
      args.opportunity.claimStrengthScore,
      args.opportunity.claimStrengthTier,
      args.opportunity.action,
      args.opportunity.existingClaimId ?? null,
      args.generatedAt,
      args.expiresAt,
    ],
  };
}

export async function replaceChallengeOpportunities(args: {
  locale: string;
  opportunities: Array<ChallengeOpportunity & { expiresAt: number }>;
  generatedAt?: number;
}): Promise<void> {
  const pool = await getDb();
  const generatedAt = args.generatedAt ?? Date.now();
  const statements: SqlStatement[] = [
    {
      sql:  "DELETE FROM challenge_opportunities WHERE locale = ?",
      args: [args.locale],
    },
    ...args.opportunities.map((opportunity) =>
      buildChallengeOpportunityInsertStatement({
        locale: args.locale,
        opportunity,
        generatedAt,
        expiresAt: opportunity.expiresAt,
      })
    ),
  ];
  await batchWrite(pool, statements);
}

export async function pruneExpiredChallengeOpportunities(nowMs = Date.now()): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql:  "DELETE FROM challenge_opportunities WHERE expires_at <= ?",
    args: [nowMs],
  });
}

export async function getActiveChallengeOpportunities(args?: {
  locale?: string;
  limit?: number;
  nowMs?: number;
}): Promise<ChallengeOpportunityRow[]> {
  const pool = await getDb();
  const locale = args?.locale === "es" ? "es" : "en";
  const limit =
    typeof args?.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : 6;
  const nowMs = args?.nowMs ?? Date.now();
  const result = await execute(pool, {
    sql: `SELECT * FROM challenge_opportunities
      WHERE locale = ?
        AND expires_at > ?
      ORDER BY
        CASE action WHEN 'challenge' THEN 0 ELSE 1 END ASC,
        claim_strength_score DESC,
        confidence_score DESC,
        generated_at DESC
      LIMIT ?`,
    args: [locale, nowMs, limit],
  });
  return result.rows.map((row) => normalizeChallengeOpportunityRow(row as Record<string, unknown>));
}

// ── x402 payment ledger ───────────────────────────────────────────────────────
// Durable record of every settled x402 payment. The chain settlements are the
// ultimate source of truth; this powers /revenue and survives restarts (unlike
// the in-memory ring buffer). Every amount here is ATOMIC token units.

export interface PaymentRow {
  resource: string;
  scheme: string;
  network: string;
  asset_address: string;
  asset_symbol: string;
  asset_decimals: number;
  amount_atomic: bigint;
  payer: string | null;
  seller: string | null;
  transaction_hash: string | null;
  payment_identifier: string;
  facilitator: string | null;
  settled_at: number;
  created_at: number;
}

export interface PaymentsRevenueSummary {
  totalCalls: number;
  /** Sum of amount_atomic across the ledger. */
  totalAtomic: bigint;
  uniquePayers: number;
  uniqueSellers: number;
  byResource: Array<{ resource: string; calls: number; amountAtomic: bigint }>;
  bySeller: Array<{ seller: string; calls: number; amountAtomic: bigint }>;
  recent: PaymentRow[];
}

export interface MarketSettlementRow {
  claim_id: number;
  gross_volume_atomic: bigint;
  payout_atomic: bigint;
  platform_fee_atomic: bigint;
  agent_owner_fee_atomic: bigint;
  dust_atomic: bigint;
  transaction_hash: string;
  settled_at: number;
}

export interface FeeAccrualRow {
  accrual_id: string;
  claim_id: number;
  recipient: string;
  source: "platform" | "agent_owner";
  amount_atomic: bigint;
  transaction_hash: string;
  log_index: number;
  accrued_at: number;
}

export interface FeeClaimRow {
  claim_event_id: string;
  recipient: string;
  amount_atomic: bigint;
  transaction_hash: string;
  log_index: number;
  claimed_at: number;
}

export interface MarketRevenueSummary {
  settledMarkets: number;
  grossVolumeAtomic: bigint;
  payoutAtomic: bigint;
  platformFeeAtomic: bigint;
  agentOwnerFeeAtomic: bigint;
  dustAtomic: bigint;
  unclaimedAtomic: bigint;
}

/** NUMERIC(78,0) comes back as a string from pg — parse it, never via Number(). */
function getBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim().length > 0) return BigInt(value.trim());
  return 0n;
}

export interface MarketProposalRow {
  proposal_id: string;
  created_at: number;
  question: string;
  creator_position: string;
  counter_position: string;
  category: string;
  subject_type: string;
  settlement_mode: string;
  product_modifiers: string[];
  mode_rationale: string;
  stake_policy: Record<string, unknown>;
  context_pack_hash: string | null;
  resolution_url: string;
  settlement_rule: string;
  deadline: number;
  quality_score: number;
  preflight_verdict: Record<string, unknown>;
  disposition: string;
  blocked_by: string | null;
  claim_id: number | null;
}

/**
 * Record a market-creator proposal.
 *
 * Idempotent on proposal_id: a worker retrying a run must not create a second
 * record of the same decision, or shadow-mode precision would be measured against
 * inflated counts.
 */
export async function insertMarketProposal(row: MarketProposalRow): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql: `INSERT INTO market_proposals (
      proposal_id, created_at, question, creator_position, counter_position, category,
      subject_type, settlement_mode, product_modifiers, mode_rationale, stake_policy,
      context_pack_hash, resolution_url, settlement_rule, deadline, quality_score,
      preflight_verdict, disposition, blocked_by, claim_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (proposal_id) DO NOTHING`,
    args: [
      row.proposal_id,
      row.created_at,
      row.question,
      row.creator_position,
      row.counter_position,
      row.category,
      row.subject_type,
      row.settlement_mode,
      JSON.stringify(row.product_modifiers),
      row.mode_rationale,
      JSON.stringify(row.stake_policy),
      row.context_pack_hash,
      row.resolution_url,
      row.settlement_rule,
      row.deadline,
      row.quality_score,
      JSON.stringify(row.preflight_verdict),
      row.disposition,
      row.blocked_by,
      row.claim_id,
    ],
  });
}

/** Link a published claim back to the proposal that produced it. */
export async function attachProposalClaimId(proposalId: string, claimId: number): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql: "UPDATE market_proposals SET claim_id = ? WHERE proposal_id = ?",
    args: [claimId, proposalId],
  });
}

/**
 * Shadow-mode precision: of the proposals a human reviewed, how many did they
 * agree with? This is the number the roadmap gates autonomous publishing on, so it
 * deliberately reports the reviewed count too — 100% of two reviews is not
 * evidence.
 */
export async function getProposalPrecision(): Promise<{
  total: number;
  reviewed: number;
  agreed: number;
  precisionBps: number | null;
}> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql: `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE review <> 'unreviewed') AS reviewed,
      COUNT(*) FILTER (WHERE review = 'agree') AS agreed
    FROM market_proposals`,
  });
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  const total = Number(row.total ?? 0);
  const reviewed = Number(row.reviewed ?? 0);
  const agreed = Number(row.agreed ?? 0);
  return {
    total,
    reviewed,
    agreed,
    precisionBps: reviewed > 0 ? Math.round((agreed * 10_000) / reviewed) : null,
  };
}

export async function insertPayment(e: PaymentRow): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql: `INSERT INTO payments_v2 (
      resource, scheme, network, asset_address, asset_symbol, asset_decimals,
      amount_atomic, payer, seller, transaction_hash, payment_identifier,
      facilitator, settled_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(network, payment_identifier) DO NOTHING`,
    args: [
      e.resource,
      e.scheme,
      e.network,
      e.asset_address.toLowerCase(),
      e.asset_symbol,
      e.asset_decimals,
      // NUMERIC accepts the decimal string; bigint is not a pg wire type.
      e.amount_atomic.toString(),
      e.payer?.toLowerCase() ?? null,
      e.seller?.toLowerCase() ?? null,
      e.transaction_hash?.toLowerCase() ?? null,
      e.payment_identifier.toLowerCase(),
      e.facilitator,
      e.settled_at,
      e.created_at,
    ],
  });
}

/** Upsert one settlement projection rebuilt from MarketSettled + FeeAccrued logs. */
export async function upsertMarketSettlement(e: MarketSettlementRow): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql: `INSERT INTO market_settlements (
      claim_id, gross_volume_atomic, payout_atomic, platform_fee_atomic,
      agent_owner_fee_atomic, dust_atomic, transaction_hash, settled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(claim_id) DO UPDATE SET
      gross_volume_atomic=excluded.gross_volume_atomic,
      payout_atomic=excluded.payout_atomic,
      platform_fee_atomic=excluded.platform_fee_atomic,
      agent_owner_fee_atomic=excluded.agent_owner_fee_atomic,
      dust_atomic=excluded.dust_atomic,
      transaction_hash=excluded.transaction_hash,
      settled_at=excluded.settled_at`,
    args: [
      e.claim_id,
      e.gross_volume_atomic.toString(),
      e.payout_atomic.toString(),
      e.platform_fee_atomic.toString(),
      e.agent_owner_fee_atomic.toString(),
      e.dust_atomic.toString(),
      e.transaction_hash.toLowerCase(),
      e.settled_at,
    ],
  });
}

/** Idempotently project FeeAccrued; replaying the same block cannot duplicate revenue. */
export async function insertFeeAccrual(e: FeeAccrualRow): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql: `INSERT INTO fee_accruals (
      accrual_id, claim_id, recipient, source, amount_atomic,
      transaction_hash, log_index, accrued_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(transaction_hash, log_index) DO NOTHING`,
    args: [e.accrual_id, e.claim_id, e.recipient.toLowerCase(), e.source,
      e.amount_atomic.toString(), e.transaction_hash.toLowerCase(), e.log_index, e.accrued_at],
  });
}

/** Idempotently project FeeClaimed without mutating the append-only accrual ledger. */
export async function insertFeeClaim(e: FeeClaimRow): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql: `INSERT INTO fee_claims (
      claim_event_id, recipient, amount_atomic, transaction_hash, log_index, claimed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(transaction_hash, log_index) DO NOTHING`,
    args: [e.claim_event_id, e.recipient.toLowerCase(), e.amount_atomic.toString(),
      e.transaction_hash.toLowerCase(), e.log_index, e.claimed_at],
  });
}

/** Atomic market totals. x402 is deliberately queried separately and merged at the API boundary. */
export async function getMarketRevenueSummary(): Promise<MarketRevenueSummary> {
  const pool = await getDb();
  const [settlements, accruals] = await Promise.all([
    execute(pool, {
      sql: `SELECT COUNT(*) AS markets,
        COALESCE(SUM(gross_volume_atomic), 0) AS gross,
        COALESCE(SUM(payout_atomic), 0) AS payouts,
        COALESCE(SUM(platform_fee_atomic), 0) AS platform,
        COALESCE(SUM(agent_owner_fee_atomic), 0) AS agent_owner,
        COALESCE(SUM(dust_atomic), 0) AS dust
      FROM market_settlements`,
    }),
    execute(pool, {
      sql: `SELECT GREATEST(
        COALESCE((SELECT SUM(amount_atomic) FROM fee_accruals), 0) -
        COALESCE((SELECT SUM(amount_atomic) FROM fee_claims), 0), 0
      ) AS unclaimed`,
    }),
  ]);
  const s = settlements.rows[0] ?? {};
  return {
    settledMarkets: getNumber(s.markets),
    grossVolumeAtomic: getBigInt(s.gross),
    payoutAtomic: getBigInt(s.payouts),
    platformFeeAtomic: getBigInt(s.platform),
    agentOwnerFeeAtomic: getBigInt(s.agent_owner),
    dustAtomic: getBigInt(s.dust),
    unclaimedAtomic: getBigInt(accruals.rows[0]?.unclaimed),
  };
}

export async function getPaymentsRevenueSummary(limit = 25): Promise<PaymentsRevenueSummary> {
  const pool = await getDb();
  const [totals, byResource, bySeller, recent] = await Promise.all([
    execute(pool, {
      sql: `SELECT COUNT(*) AS calls, COALESCE(SUM(amount_atomic), 0) AS atomic,
              COUNT(DISTINCT payer) FILTER (WHERE payer IS NOT NULL) AS payers,
              COUNT(DISTINCT seller) FILTER (WHERE seller IS NOT NULL) AS sellers
            FROM payments_v2`,
    }),
    execute(pool, {
      sql: `SELECT resource, COUNT(*) AS calls, COALESCE(SUM(amount_atomic), 0) AS atomic
            FROM payments_v2 GROUP BY resource ORDER BY atomic DESC`,
    }),
    execute(pool, {
      sql: `SELECT seller, COUNT(*) AS calls, COALESCE(SUM(amount_atomic), 0) AS atomic
            FROM payments_v2
            WHERE seller IS NOT NULL
            GROUP BY seller
            ORDER BY atomic DESC`,
    }),
    execute(pool, {
      sql: `SELECT resource, scheme, network, asset_address, asset_symbol, asset_decimals,
              amount_atomic, payer, seller, transaction_hash, payment_identifier,
              facilitator, settled_at, created_at
            FROM payments_v2 ORDER BY settled_at DESC, id DESC LIMIT ?`,
      args: [limit],
    }),
  ]);
  const t = totals.rows[0] ?? {};
  return {
    totalCalls: getNumber(t.calls),
    totalAtomic: getBigInt(t.atomic),
    uniquePayers: getNumber(t.payers),
    uniqueSellers: getNumber(t.sellers),
    byResource: byResource.rows.map((r) => ({
      resource: getString(r.resource),
      calls: getNumber(r.calls),
      amountAtomic: getBigInt(r.atomic),
    })),
    bySeller: bySeller.rows.map((r) => ({
      seller: getString(r.seller),
      calls: getNumber(r.calls),
      amountAtomic: getBigInt(r.atomic),
    })),
    recent: recent.rows.map((r) => ({
      resource: getString(r.resource),
      scheme: getString(r.scheme),
      network: getString(r.network),
      asset_address: getString(r.asset_address),
      asset_symbol: getString(r.asset_symbol),
      asset_decimals: getNumber(r.asset_decimals),
      amount_atomic: getBigInt(r.amount_atomic),
      payer: getNullableString(r.payer),
      seller: getNullableString(r.seller),
      transaction_hash: getNullableString(r.transaction_hash),
      payment_identifier: getString(r.payment_identifier),
      facilitator: getNullableString(r.facilitator),
      settled_at: getNumber(r.settled_at),
      created_at: getNumber(r.created_at),
    })),
  };
}

// ── Agent reasoning feed ──────────────────────────────────────────────────────
// Append-only. insertReasoningEvent is idempotent on the deterministic event_id,
// so a worker retry cannot duplicate a juror's published rationale.

export interface ReasoningEventRow {
  event_id: string;
  schema_version: number;
  claim_id: number;
  agent_id: string;
  track: string;
  stage: string;
  position: string;
  confidence_bps: number;
  summary: string;
  uncertainty: string;
  evidence_refs_json: string;
  model: string | null;
  provider: string | null;
  prompt_version: number | null;
  payment_identifier: string | null;
  visibility: string;
  safety_findings_json: string;
  created_at: number;
  tombstoned_at: number | null;
  tombstone_reason: string | null;
}

function normalizeReasoningRow(row: Record<string, unknown>): ReasoningEventRow {
  return {
    event_id: getString(row.event_id),
    schema_version: getNumber(row.schema_version),
    claim_id: getNumber(row.claim_id),
    agent_id: getString(row.agent_id),
    track: getString(row.track),
    stage: getString(row.stage),
    position: getString(row.position),
    confidence_bps: getNumber(row.confidence_bps),
    summary: getString(row.summary),
    uncertainty: getString(row.uncertainty),
    evidence_refs_json: getString(row.evidence_refs_json),
    model: getNullableString(row.model),
    provider: getNullableString(row.provider),
    prompt_version: row.prompt_version == null ? null : getNumber(row.prompt_version),
    payment_identifier: getNullableString(row.payment_identifier),
    visibility: getString(row.visibility),
    safety_findings_json: getString(row.safety_findings_json),
    created_at: getNumber(row.created_at),
    tombstoned_at: row.tombstoned_at == null ? null : getNumber(row.tombstoned_at),
    tombstone_reason: getNullableString(row.tombstone_reason),
  };
}

export async function insertReasoningEvent(row: Omit<ReasoningEventRow, "tombstoned_at" | "tombstone_reason">): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql: `INSERT INTO agent_reasoning_events (
      event_id, schema_version, claim_id, agent_id, track, stage, position,
      confidence_bps, summary, uncertainty, evidence_refs_json, model, provider,
      prompt_version, payment_identifier, visibility, safety_findings_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING`,
    args: [
      row.event_id,
      row.schema_version,
      row.claim_id,
      row.agent_id,
      row.track,
      row.stage,
      row.position,
      row.confidence_bps,
      row.summary,
      row.uncertainty,
      row.evidence_refs_json,
      row.model,
      row.provider,
      row.prompt_version,
      row.payment_identifier,
      row.visibility,
      row.safety_findings_json,
      row.created_at,
    ],
  });
}

export interface ReasoningFeedFilters {
  claimId: number;
  /** Omit to return every track. */
  track?: string;
  agentId?: string;
  stage?: string;
  limit?: number;
}

/**
 * Chronological feed for one claim. Withheld and tombstoned events are excluded
 * from the public read; they stay in the table as the audit trail.
 */
export async function getReasoningFeed(filters: ReasoningFeedFilters): Promise<ReasoningEventRow[]> {
  const pool = await getDb();
  const clauses = ["claim_id = ?", "visibility <> 'withheld'", "tombstoned_at IS NULL"];
  const args: Array<string | number> = [filters.claimId];
  if (filters.track) {
    clauses.push("track = ?");
    args.push(filters.track);
  }
  if (filters.agentId) {
    clauses.push("agent_id = ?");
    args.push(filters.agentId);
  }
  if (filters.stage) {
    clauses.push("stage = ?");
    args.push(filters.stage);
  }
  const limit = typeof filters.limit === "number" && filters.limit > 0 ? Math.floor(filters.limit) : 200;
  args.push(limit);
  const result = await execute(pool, {
    sql: `SELECT * FROM agent_reasoning_events
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at ASC, event_id ASC
      LIMIT ?`,
    args,
  });
  return result.rows.map((row) => normalizeReasoningRow(row as Record<string, unknown>));
}

/**
 * Withdraw an event. The row is kept and marked, never deleted — a deletion would
 * silently rewrite the record of what an agent said.
 */
export async function tombstoneReasoningEvent(eventId: string, reason: string): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql: `UPDATE agent_reasoning_events
      SET tombstoned_at = ?, tombstone_reason = ?, visibility = 'withheld'
      WHERE event_id = ? AND tombstoned_at IS NULL`,
    args: [Date.now(), reason, eventId],
  });
}
