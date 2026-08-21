import { pruneSibylMemoryEvents } from "../lib/db";

const days = Number(process.env.SIBYL_NEON_RETENTION_DAYS ?? "0");
const limit = Number(process.env.SIBYL_NEON_RETENTION_BATCH ?? "1000");

if (process.env.SIBYL_NEON_ARCHIVE !== "1") {
  console.error("SIBYL_NEON_ARCHIVE=1 is required; no rows were deleted.");
  process.exitCode = 1;
} else if (!Number.isFinite(days) || days <= 0) {
  console.error("Set SIBYL_NEON_RETENTION_DAYS to a positive number; no rows were deleted.");
  process.exitCode = 1;
} else {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const deleted = await pruneSibylMemoryEvents({ olderThanMs: cutoff, limit });
  console.log(`[sibyl-retention] deleted ${deleted} Neon archive rows older than ${days} days`);
}
