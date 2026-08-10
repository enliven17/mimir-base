import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRACT_VERSION,
  SETTLEMENT_MODE_POLICY,
  isUnsupportedMode,
  selectableSettlementModes,
  settlementModeToOddsMode,
  toCanonicalMode,
  validateMode,
} from "../../lib/market-modes";

// ── on-chain → canonical ──────────────────────────────────────────────────────

test("a multi-slot pool market maps to pool", () => {
  const mode = toCanonicalMode({ marketType: "binary", oddsMode: "pool", maxChallengers: 100 });
  assert.equal(mode.subjectType, "binary");
  assert.equal(mode.settlementMode, "pool");
  assert.equal(isUnsupportedMode(mode), false);
});

test("a single-slot pool market IS a duel", () => {
  // The contract cannot express duel directly; one slot + equal stakes is the
  // v1 encoding, so the codec must recover it rather than showing pool math.
  const mode = toCanonicalMode({ marketType: "binary", oddsMode: "pool", maxChallengers: 1 });
  assert.equal(mode.settlementMode, "duel");
});

test("'fixed' maps to fixed_odds and stays fixed_odds at one slot", () => {
  assert.equal(
    toCanonicalMode({ marketType: "total", oddsMode: "fixed", maxChallengers: 100 }).settlementMode,
    "fixed_odds",
  );
  assert.equal(
    toCanonicalMode({ marketType: "total", oddsMode: "fixed", maxChallengers: 1 }).settlementMode,
    "fixed_odds",
  );
});

test("an unknown subject type degrades to custom without flagging unsupported", () => {
  const mode = toCanonicalMode({ marketType: "parlay", oddsMode: "pool", maxChallengers: 4 });
  assert.equal(mode.subjectType, "custom");
  assert.equal(isUnsupportedMode(mode), false);
});

test("an unknown odds mode is flagged unsupported, never silently pooled", () => {
  const mode = toCanonicalMode({ marketType: "binary", oddsMode: "dutch-book", maxChallengers: 4 });
  assert.equal(isUnsupportedMode(mode), true);
  assert.deepEqual(mode.unsupported, { marketType: "binary", oddsMode: "dutch-book" });
});

test("settlement mode round-trips through the on-chain odds string", () => {
  assert.equal(settlementModeToOddsMode("pool"), "pool");
  assert.equal(settlementModeToOddsMode("fixed_odds"), "fixed");
  // duel is escrowed as a one-slot pool
  assert.equal(settlementModeToOddsMode("duel"), "pool");
});

// ── validation: the combinations that must be rejected ────────────────────────

test("duel rejects a second challenger slot", () => {
  const result = validateMode({
    subjectType: "binary",
    settlementMode: "duel",
    maxChallengers: 2,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /at most 1 challenger/);
});

test("duel rejects unequal stakes", () => {
  const result = validateMode({
    subjectType: "binary",
    settlementMode: "duel",
    maxChallengers: 1,
    creatorStake: 10,
    challengerStake: 7,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /equal the creator stake/);
});

test("duel accepts one rival at an equal stake", () => {
  assert.deepEqual(
    validateMode({
      subjectType: "binary",
      settlementMode: "duel",
      maxChallengers: 1,
      creatorStake: 10,
      challengerStake: 10,
    }),
    { ok: true, errors: [] },
  );
});

test("fixed odds rejects a total return at or below 1x", () => {
  for (const bps of [0, 9_000, 10_000]) {
    const result = validateMode({
      subjectType: "binary",
      settlementMode: "fixed_odds",
      challengerPayoutBps: bps,
    });
    assert.equal(result.ok, false, `bps ${bps} should be rejected`);
    assert.match(result.errors.join(" "), /total return above 1x/);
  }
});

test("fixed odds rejects undercollateralised liquidity on profit, not gross payout", () => {
  // 2x on a 10 USDC stake owes 10 USDC of PROFIT. 8 of creator liquidity is short…
  const short = validateMode({
    subjectType: "binary",
    settlementMode: "fixed_odds",
    challengerPayoutBps: 20_000,
    creatorStake: 8,
    challengerStake: 10,
  });
  assert.equal(short.ok, false);
  assert.match(short.errors.join(" "), /undercollateralised/);

  // …and exactly 10 is enough, even though the gross payout is 20.
  assert.equal(
    validateMode({
      subjectType: "binary",
      settlementMode: "fixed_odds",
      challengerPayoutBps: 20_000,
      creatorStake: 10,
      challengerStake: 10,
    }).ok,
    true,
  );
});

test("a pool market may not carry fixed-odds bps", () => {
  const result = validateMode({
    subjectType: "binary",
    settlementMode: "pool",
    challengerPayoutBps: 20_000,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /does not use challengerPayoutBps/);
});

test("rematch_ladder requires a parent claim", () => {
  const orphan = validateMode({
    subjectType: "binary",
    settlementMode: "pool",
    productModifiers: ["rematch_ladder"],
  });
  assert.equal(orphan.ok, false);
  assert.match(orphan.errors.join(" "), /settled parent/);

  assert.equal(
    validateMode({
      subjectType: "binary",
      settlementMode: "pool",
      productModifiers: ["rematch_ladder"],
      parentId: 12,
    }).ok,
    true,
  );
});

test("unknown enum values are rejected rather than coerced", () => {
  const result = validateMode({
    subjectType: "parlay",
    settlementMode: "pool",
    productModifiers: ["moon_boost"],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /unknown subjectType/);
  assert.match(result.errors.join(" "), /unknown productModifier/);
});

// ── contract-version gating ───────────────────────────────────────────────────

test("squad_pool is refused on the v1 contract and is not selectable", () => {
  const result = validateMode({ subjectType: "binary", settlementMode: "squad_pool" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /needs contract v2/);
  assert.equal(SETTLEMENT_MODE_POLICY.squad_pool.selectableOnCreate, false);
  assert.equal(
    selectableSettlementModes(CONTRACT_VERSION).some((p) => p.mode === "squad_pool"),
    false,
  );
});

test("the three live modes are selectable on the deployed contract", () => {
  assert.deepEqual(
    selectableSettlementModes(1).map((p) => p.mode),
    ["pool", "duel", "fixed_odds"],
  );
});

test("squad_pool becomes valid once a v2 contract is deployed", () => {
  assert.equal(
    validateMode({ subjectType: "binary", settlementMode: "squad_pool", contractVersion: 2 }).ok,
    true,
  );
});
