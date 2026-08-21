import test from "node:test";
import assert from "node:assert/strict";
import { parseAcpModelDecision, parseAcpRequirement } from "../../agents/virtuals/acp-assessment";

test("ACP requirement parser accepts the market intelligence contract", () => {
  const value = parseAcpRequirement({
    claimQuestion: "Will the source support the claim?",
    resolutionUrl: "https://example.com/source",
    requestedStakeUsdc: 2,
  });
  assert.equal(value.requestedStakeUsdc, 2);
  assert.equal(value.creatorPosition, "The claim is true");
});

test("ACP requirement parser rejects credential-bearing URLs", () => {
  assert.throws(
    () => parseAcpRequirement({
      claimQuestion: "Will the source support the claim?",
      resolutionUrl: "https://user:pass@example.com/source",
    }),
    /credentials/,
  );
});

test("ACP model output is bounded and parsed from fenced JSON", () => {
  const value = parseAcpModelDecision(
    "Here is the result:\n```json\n{\"decision\":\"ACCEPT\",\"confidence\":91,\"explanation\":\"The source is clear.\"}\n```",
  );
  assert.deepEqual(value, {
    decision: "ACCEPT",
    confidence: 91,
    explanation: "The source is clear.",
  });
});
