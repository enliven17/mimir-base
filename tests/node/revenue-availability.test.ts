import assert from 'node:assert/strict';
import test from 'node:test';
import { getRevenueSummary } from '../../lib/paid-revenue';

test('configured ledger failure rejects rather than returning a false zero', async () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousReady = globalThis.__mimirDbReady;
  process.env.DATABASE_URL = 'postgresql://unused:unused@invalid/unused';
  const failed = Promise.reject(new Error('ledger unavailable'));
  failed.catch(() => {});
  globalThis.__mimirDbReady = failed;
  try { await assert.rejects(getRevenueSummary(), /ledger unavailable/); }
  finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    globalThis.__mimirDbReady = previousReady;
  }
});
