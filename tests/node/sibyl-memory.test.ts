import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyChallengeMemory,
  challengeGateForUrl,
  ensureSibyl,
  loadSource,
  rememberOracleEvaluation,
  stopSibyl,
  TENANTS,
} from "../../lib/sibyl/memory";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimir-sibyl-"));
const dbPath = path.join(dbDir, "memory.db");
const port = String(18788 + Math.floor(Math.random() * 1000));

process.env.SIBYL_MEMORY_DB = dbPath;
process.env.SIBYL_MEMORY_PORT = port;
process.env.SIBYL_MEMORY_URL = `http://127.0.0.1:${port}`;
process.env.SIBYL_REQUIRED = "1";

test("Sibyl sidecar persists a source and a fresh client changes the challenge", async (t) => {
  try {
    await ensureSibyl();
  } catch (err) {
    t.skip(`real sibyl-memory-client sidecar required: ${err instanceof Error ? err.message : err}`);
    return;
  }

  try {
    const url = "https://api.coingecko.com/api/v3/coins/bitcoin";

    const before = await challengeGateForUrl({
      url,
      verdict: "CHALLENGERS_WIN",
      confidence: 92,
      minConfidence: 80,
    });
    assert.equal(before.gate.allow, true, "empty Sibyl store must not block a first challenge");

    await rememberOracleEvaluation({
      url,
      claimId: 11,
      verdict: "UNRESOLVABLE",
      confidence: 40,
      action: "evaluate",
    });
    await rememberOracleEvaluation({
      url,
      claimId: 12,
      verdict: "UNRESOLVABLE",
      confidence: 35,
      action: "evaluate",
    });

    const recalled = await loadSource(TENANTS.oracle, url);
    assert.ok(recalled);
    assert.equal(recalled.unresolvable, 2);
    assert.equal(recalled.host, "api.coingecko.com");

    const after = applyChallengeMemory({
      source: recalled,
      verdict: "CHALLENGERS_WIN",
      confidence: 92,
      minConfidence: 80,
    });
    assert.equal(after.allow, false);
    assert.equal(after.veto, "unreliable-source");

    const freshProcessGate = await challengeGateForUrl({
      url,
      verdict: "CHALLENGERS_WIN",
      confidence: 92,
      minConfidence: 80,
    });
    assert.equal(freshProcessGate.gate.allow, false, "recall across RPC must still veto");
  } finally {
    stopSibyl();
  }
});
