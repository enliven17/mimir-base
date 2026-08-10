/**
 * Compile contracts/Mimir.sol and report errors/warnings + bytecode size.
 * Run: node scripts/compile-contract.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import solc from "solc";

const source = readFileSync("contracts/Mimir.sol", "utf8");
const out = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { "Mimir.sol": { content: source } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        viaIR: true,
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
  ),
);

const errors = (out.errors ?? []).filter((e) => e.severity === "error");
if (errors.length > 0) {
  console.error(errors.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}

const warnings = (out.errors ?? []).filter((e) => e.severity === "warning");
console.log(`warnings: ${warnings.length}`);
for (const w of warnings) console.log("  - " + (w.formattedMessage ?? "").split("\n")[0]);

const artifact = out.contracts["Mimir.sol"].Mimir;
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/Mimir.bin", artifact.evm.bytecode.object);
writeFileSync("artifacts/Mimir.abi.json", JSON.stringify(artifact.abi, null, 2));
console.log(`bytecode: ${artifact.evm.bytecode.object.length / 2} bytes (EIP-170 limit 24576)`);
console.log("COMPILE OK");
