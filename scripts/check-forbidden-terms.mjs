/**
 * Migration guardrail: fail the build if any BOT Chain / bespoke-402 residue is
 * left in the tree. Mimir runs on Base Sepolia only — there is no runtime
 * fallback to the old chain, so a match here is a bug, not a leftover comment.
 *
 * Run: npm run check:terms
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const FORBIDDEN = [
  ["botchain", /botchain/i],
  ["BOT Chain", /BOT[\s-]?Chain/i],
  ["bohr.life", /bohr\.life/i],
  ["chain 968", /\bchain[\s_-]?968\b|\b968\b(?=\s*\))/i],
  ["USDT", /\bUSDT\b/],
  ["USDT_ADDRESS", /USDT_ADDRESS/],
  ["amount_bot", /amount_bot/],
  ["X-Payment-Tx", /X-Payment-Tx/i],
  ["X-Payment-From", /X-Payment-From/i],
  ["BOT currency", /\bBOT\b(?!\w)/],
];

// The plan itself documents what was removed, so it is the one allowed mention.
const SKIP_FILES = new Set([
  "docs/BASE_SEPOLIA_MIGRATION_PLAN.md",
  "scripts/check-forbidden-terms.mjs",
]);

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => /\.(ts|tsx|sol|md|json|toml|js|mjs|css)$/.test(f) || f === ".env.example")
  .filter((f) => !SKIP_FILES.has(f) && !f.startsWith("package-lock.json"));

const hits = [];
for (const file of files) {
  let lines;
  try {
    lines = readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    continue;
  }
  lines.forEach((line, i) => {
    for (const [label, pattern] of FORBIDDEN) {
      if (pattern.test(line)) hits.push({ file, line: i + 1, label, text: line.trim().slice(0, 120) });
    }
  });
}

if (hits.length > 0) {
  console.error(`✗ ${hits.length} forbidden term(s) found — Mimir is Base Sepolia only:\n`);
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.label}]  ${h.text}`);
  process.exit(1);
}

console.log(`✓ no BOT Chain / bespoke-402 residue in ${files.length} tracked files`);
