import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATE_TIME_MODIFIERS,
  admitToRun,
  decideMode,
  defaultCreatorPolicy,
  duplicateSignature,
  isCreateTimeModifier,
  isDuplicate,
  signatureKey,
  type CandidateInput,
  type CreatorPolicy,
} from "../../lib/market-creator/mode-matrix";

const DEADLINE = 1_780_000_000;

/** Autonomous publishing on, so dispositions are visible without shadow review. */
function policy(overrides: Partial<CreatorPolicy> = {}): CreatorPolicy {
  return {
    maxActiveMarkets: 30,
    maxOpenExposureUsdc: 100,
    minQualityScore: 60,
    shadowMode: false,
    maxPerCategoryPerRun: 2,
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    subjectType: "binary",
    category: "crypto",
    availableLiquidityUsdc: 50,
    stakeUsdc: 5,
    openExposureUsdc: 10,
    activeMarkets: 2,
    qualityScore: 80,
    ...overrides,
  };
}

// ── Shadow mode is the default ────────────────────────────────────────────────

test("autonomous publishing is opt-in: the default policy holds for review", () => {
  // The roadmap gates autonomous publish behind measured shadow precision.
  assert.equal(defaultCreatorPolicy({}).shadowMode, true);
  assert.equal(
    defaultCreatorPolicy({ MARKET_CREATOR_AUTONOMOUS: "1" }).shadowMode,
    false,
  );
});

test("shadow mode downgrades a create to review and says so", () => {
  const decision = decideMode(candidate(), "pool", policy({ shadowMode: true }));
  assert.equal(decision.disposition, "review");
  assert.match(decision.rationale, /shadow mode/);
});

test("shadow mode never upgrades a skip into a create", () => {
  const decision = decideMode(
    candidate({ qualityScore: 10 }),
    "pool",
    policy({ shadowMode: true }),
  );
  assert.equal(decision.disposition, "skip");
});

// ── Hard blocks come first, and only the actionable reason is given ────────────

test("a low-quality candidate is skipped on quality alone", () => {
  // Also short on liquidity, but quality is the reason that matters first.
  const decision = decideMode(
    candidate({ qualityScore: 20, availableLiquidityUsdc: 0 }),
    "fixed_odds",
    policy(),
  );
  assert.equal(decision.disposition, "skip");
  assert.match(decision.blockedBy ?? "", /quality 20/);
});

test("the active-market cap blocks creation", () => {
  const decision = decideMode(candidate({ activeMarkets: 30 }), "pool", policy());
  assert.equal(decision.disposition, "skip");
  assert.match(decision.blockedBy ?? "", /30\/30 active/);
});

test("the exposure cap counts the stake about to be posted", () => {
  // 96 already committed plus a 5 stake exceeds 100.
  const decision = decideMode(
    candidate({ openExposureUsdc: 96, stakeUsdc: 5 }),
    "pool",
    policy(),
  );
  assert.equal(decision.disposition, "skip");
  assert.match(decision.blockedBy ?? "", /101 > 100/);
});

test("exposure exactly at the cap is allowed", () => {
  assert.equal(
    decideMode(candidate({ openExposureUsdc: 95, stakeUsdc: 5 }), "pool", policy()).disposition,
    "create",
  );
});

// ── Duel needs an opponent ────────────────────────────────────────────────────

test("a duel with a named opponent is created", () => {
  const decision = decideMode(candidate({ targetAgentId: "socrates" }), "duel", policy());
  assert.equal(decision.disposition, "create");
  assert.equal(decision.settlementMode, "duel");
  assert.match(decision.rationale, /socrates/);
});

test("a duel with no opponent becomes an open invitation, not a funded market", () => {
  // Nobody is obliged to take the other side, so it is an invitation.
  const decision = decideMode(candidate(), "duel", policy());
  assert.equal(decision.disposition, "open_duel_invite");
  assert.match(decision.rationale, /no named opponent/);
});

// ── Fixed odds: the agent must be able to back what it posts ──────────────────

test("fixed odds is refused when the creator cannot cover challenger profit", () => {
  // 2x on a 50 USDC stake owes 50 of profit; only 10 is unreserved.
  const decision = decideMode(
    candidate({ stakeUsdc: 50, availableLiquidityUsdc: 10, challengerPayoutBps: 20_000 }),
    "fixed_odds",
    policy({ maxOpenExposureUsdc: 1_000 }),
  );
  assert.equal(decision.disposition, "skip");
  assert.match(decision.blockedBy ?? "", /needs 50, has 10/);
});

test("fixed odds is created when the liquidity covers the profit", () => {
  const decision = decideMode(
    candidate({ stakeUsdc: 10, availableLiquidityUsdc: 10, challengerPayoutBps: 20_000 }),
    "fixed_odds",
    policy(),
  );
  assert.equal(decision.disposition, "create");
  assert.match(decision.rationale, /2\.00x total return/);
});

test("fixed odds at or below 1x is refused rather than normalised", () => {
  for (const bps of [0, 9_500, 10_000]) {
    const decision = decideMode(
      candidate({ challengerPayoutBps: bps }),
      "fixed_odds",
      policy(),
    );
    assert.equal(decision.disposition, "skip", `bps ${bps} should be refused`);
  }
});

// ── Contract gating ───────────────────────────────────────────────────────────

test("squad markets are never proposed on the v1 escrow", () => {
  const decision = decideMode(candidate(), "squad_pool", policy());
  assert.equal(decision.disposition, "skip");
  assert.match(decision.blockedBy ?? "", /contract v2/);
});

// ── Modifiers are not creation-time modes ─────────────────────────────────────

test("only rematch_ladder is a creation-time modifier", () => {
  // Underdog is a property of a pool that has formed; streak and conviction are
  // projections over resolved claims. An agent cannot create any of them.
  assert.deepEqual(CREATE_TIME_MODIFIERS, ["rematch_ladder"]);
  assert.equal(isCreateTimeModifier("rematch_ladder"), true);
  assert.equal(isCreateTimeModifier("underdog_boost"), false);
  assert.equal(isCreateTimeModifier("streak"), false);
  assert.equal(isCreateTimeModifier("conviction"), false);
});

test("a settled parent adds the rematch modifier", () => {
  const decision = decideMode(
    candidate({ parentClaimId: 7, parentIsSettled: true }),
    "pool",
    policy(),
  );
  assert.deepEqual(decision.modifiers, ["rematch_ladder"]);
});

test("an unsettled parent does not — there is no result to run back from", () => {
  const decision = decideMode(
    candidate({ parentClaimId: 7, parentIsSettled: false }),
    "pool",
    policy(),
  );
  assert.deepEqual(decision.modifiers, []);
});

// ── Duplicate detection by meaning, not wording ───────────────────────────────

test("a reworded question is still the same market", () => {
  // The whole point: an LLM rewords endlessly, so strings are useless.
  const a = duplicateSignature({
    entities: ["BTC"],
    event: "daily close above threshold",
    threshold: 100_000,
    units: "USD",
    deadline: DEADLINE,
  });
  const b = duplicateSignature({
    entities: ["btc"],
    event: "Daily   Close Above Threshold",
    threshold: 100_000,
    units: "usd",
    deadline: DEADLINE + 3_600,
  });
  assert.equal(signatureKey(a), signatureKey(b));
  assert.equal(isDuplicate(b, [a]), true);
});

test("a different threshold on the same entity is a different market", () => {
  const a = duplicateSignature({ entities: ["BTC"], event: "close above", threshold: 100_000, deadline: DEADLINE });
  const b = duplicateSignature({ entities: ["BTC"], event: "close above", threshold: 120_000, deadline: DEADLINE });
  assert.notEqual(signatureKey(a), signatureKey(b));
  assert.equal(isDuplicate(b, [a]), false);
});

test("a different deadline DAY is a different market", () => {
  const a = duplicateSignature({ entities: ["BTC"], event: "close above", threshold: 1, deadline: DEADLINE });
  const b = duplicateSignature({
    entities: ["BTC"],
    event: "close above",
    threshold: 1,
    deadline: DEADLINE + 86_400 * 3,
  });
  assert.notEqual(signatureKey(a), signatureKey(b));
});

test("entity order and duplicates do not change the signature", () => {
  const a = duplicateSignature({ entities: ["BTC", "ETH"], event: "e", deadline: DEADLINE });
  const b = duplicateSignature({ entities: ["eth", "BTC", "ETH"], event: "e", deadline: DEADLINE });
  assert.equal(signatureKey(a), signatureKey(b));
});

test("empty entity strings are dropped rather than forming a key", () => {
  const signature = duplicateSignature({ entities: ["BTC", "", "  "], event: "e", deadline: DEADLINE });
  assert.deepEqual(signature.entities, ["btc"]);
});

// ── Run admission ─────────────────────────────────────────────────────────────

function slot(category: string, threshold: number) {
  return {
    category,
    signature: duplicateSignature({
      entities: ["BTC"],
      event: "close above",
      threshold,
      deadline: DEADLINE,
    }),
  };
}

test("a duplicate is refused within the same run", () => {
  const accepted = [slot("crypto", 100_000)];
  const result = admitToRun(slot("crypto", 100_000), accepted, policy());
  assert.equal(result.admitted, false);
  assert.equal(result.reason, "duplicate");
});

test("the per-category quota stops one topic flooding the feed", () => {
  const accepted = [slot("crypto", 1), slot("crypto", 2)];
  const result = admitToRun(slot("crypto", 3), accepted, policy({ maxPerCategoryPerRun: 2 }));
  assert.equal(result.admitted, false);
  assert.equal(result.reason, "category_quota");
  // A different category still has room.
  assert.equal(admitToRun(slot("sports", 3), accepted, policy()).admitted, true);
});

test("the per-run cap applies across categories", () => {
  const accepted = [slot("a", 1), slot("b", 2), slot("c", 3)];
  const result = admitToRun(slot("d", 4), accepted, policy(), 3);
  assert.equal(result.admitted, false);
  assert.equal(result.reason, "run_quota");
});

test("admission only ever refuses — quotas are not a mandate to pad", () => {
  // A run that finds two good markets should publish two, not manufacture five.
  const result = admitToRun(slot("crypto", 9), [], policy());
  assert.deepEqual(result, { admitted: true });
});
