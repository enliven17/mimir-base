/**
 * Compile the contracts and report errors, warnings and bytecode size.
 *
 * Run: node scripts/compile-contract.mjs [Name]
 * With no argument it compiles every contract; a name compiles just that one.
 *
 * Fails the process on any error, and on a contract that exceeds the EIP-170
 * deploy limit — a contract that cannot be deployed is a build failure, not a
 * warning to notice later.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import solc from "solc";

const CONTRACTS = ["Mimir", "MimirV2", "MimirSquad"];
const EIP170_LIMIT = 24_576;

const only = process.argv[2];
const targets = only ? CONTRACTS.filter((name) => name === only) : CONTRACTS;
if (targets.length === 0) {
  console.error(`unknown contract '${only}'. known: ${CONTRACTS.join(", ")}`);
  process.exit(1);
}

const sources = {};
for (const name of targets) {
  sources[`${name}.sol`] = { content: readFileSync(`contracts/${name}.sol`, "utf8") };
}

const out = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources,
      settings: {
        optimizer: { enabled: true, runs: 200 },
        // Required: the create flow exceeds stack depth without it.
        viaIR: true,
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
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

mkdirSync("artifacts", { recursive: true });
let overLimit = false;
for (const name of targets) {
  const artifact = out.contracts[`${name}.sol`][name];
  const bytes = artifact.evm.bytecode.object.length / 2;
  writeFileSync(`artifacts/${name}.bin`, artifact.evm.bytecode.object);
  writeFileSync(`artifacts/${name}.runtime.bin`, artifact.evm.deployedBytecode.object);
  writeFileSync(`artifacts/${name}.abi.json`, JSON.stringify(artifact.abi, null, 2));
  console.log(`${name}: ${bytes} bytes (${EIP170_LIMIT - bytes} under the EIP-170 limit)`);
  if (bytes > EIP170_LIMIT) overLimit = true;
}

if (overLimit) {
  console.error("a contract exceeds the EIP-170 deploy limit and cannot be deployed");
  process.exit(1);
}
console.log("COMPILE OK");
