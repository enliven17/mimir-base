import assert from "node:assert/strict";
import test from "node:test";

import {
  applyChallengeMemory,
  applyCreateMemory,
  applyPersonaStakeMemory,
  confidencePenalty,
  emptySource,
  recordSourceVerdict,
  sourceIsUnreliable,
} from "../../lib/sibyl/policy";
import { sourceKeyFromUrl } from "../../lib/sibyl/source-key";

test("a source with no history is not unreliable", () => {
  assert.equal(sourceIsUnreliable(null), false);
  assert.equal(sourceIsUnreliable(emptySource("example.com")), false);
});

test("two unresolvable reads with no decisive outcomes veto challenge and create", () => {
  const source = recordSourceVerdict(null, "bad.example", {
    claimId: 1,
    verdict: "UNRESOLVABLE",
    action: "evaluate",
    increment: { evaluations: 1, unresolvable: 2 },
  });
  assert.equal(sourceIsUnreliable(source), true);

  const challenge = applyChallengeMemory({
    source,
    verdict: "CHALLENGERS_WIN",
    confidence: 95,
    minConfidence: 80,
  });
  assert.equal(challenge.allow, false);
  assert.equal(challenge.veto, "unreliable-source");

  const create = applyCreateMemory(source);
  assert.equal(create.allow, false);
  assert.equal(create.veto, "unreliable-source");
});

test("the same LLM verdict stakes when memory is empty and refuses after recall", () => {
  const empty = applyChallengeMemory({
    source: null,
    verdict: "CHALLENGERS_WIN",
    confidence: 90,
    minConfidence: 80,
  });
  assert.equal(empty.allow, true);

  const remembered = applyChallengeMemory({
    source: {
      ...emptySource("api.coingecko.com"),
      unresolvable: 3,
      challengersWin: 0,
      creatorWins: 0,
    },
    verdict: "CHALLENGERS_WIN",
    confidence: 90,
    minConfidence: 80,
  });
  assert.equal(remembered.allow, false);
});

test("draws and unresolvable reads cut confidence below the stake floor", () => {
  const source = {
    ...emptySource("espn.com"),
    unresolvable: 1,
    draws: 2,
  };
  assert.equal(confidencePenalty(source), 16);
  const gate = applyChallengeMemory({
    source,
    verdict: "CHALLENGERS_WIN",
    confidence: 85,
    minConfidence: 80,
  });
  assert.equal(gate.allow, false);
  assert.equal(gate.adjustedConfidence, 69);
  assert.equal(gate.veto, "confidence-penalty");
});

test("a persona that stood aside twice on a source cannot stake there later", () => {
  const allowed = applyPersonaStakeMemory({
    source: { host: "x.com", evaluations: 1, abstentions: 1, stakes: 0, lastVerdict: null, lastClaimId: 1, updatedAt: "" },
    wantsToStake: true,
    confidence: 90,
  });
  assert.equal(allowed.allow, true);

  const vetoed = applyPersonaStakeMemory({
    source: { host: "x.com", evaluations: 2, abstentions: 2, stakes: 0, lastVerdict: "CREATOR_WINS", lastClaimId: 2, updatedAt: "" },
    wantsToStake: true,
    confidence: 90,
  });
  assert.equal(vetoed.allow, false);
  assert.equal(vetoed.veto, "persona-source-abstain");
});

test("resolution URLs collapse to a stable host key", () => {
  assert.deepEqual(sourceKeyFromUrl("https://api.coingecko.com/api/v3/coins/bitcoin"), {
    host: "api.coingecko.com",
    key: "api.coingecko.com",
  });
});
