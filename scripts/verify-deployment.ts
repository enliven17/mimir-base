import { readFileSync } from "node:fs";
import path from "node:path";
import { createPublicClient, getAddress, http, isAddress, keccak256, parseAbi } from "viem";
// solc does not publish TypeScript declarations.
// @ts-expect-error -- runtime package API is validated by the compile output below.
import solc from "solc";
import { baseSepolia, getBaseRpcUrl } from "../lib/base";
import { USDC_ADDRESS } from "../lib/usdc";

type ContractName = "Mimir" | "MimirV2";
const contractName = (process.env.MIMIR_CONTRACT_NAME?.trim() || "Mimir") as ContractName;
if (!(["Mimir", "MimirV2"] as string[]).includes(contractName)) throw new Error(`unsupported MIMIR_CONTRACT_NAME ${contractName}`);
const rawAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim();
if (!rawAddress || !isAddress(rawAddress)) throw new Error("valid NEXT_PUBLIC_CONTRACT_ADDRESS is required");
const address = getAddress(rawAddress);

function compileRuntime(): { runtime: `0x${string}`; immutableRanges: Array<{ start: number; length: number }> } {
  const file = `${contractName}.sol`;
  const source = readFileSync(path.resolve(process.cwd(), "contracts", file), "utf8");
  const output = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { [file]: { content: source } }, settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true,
    outputSelection: { "*": { "*": ["evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } },
  } })));
  const errors = (output.errors ?? []).filter((entry: { severity: string }) => entry.severity === "error");
  if (errors.length) throw new Error(errors.map((entry: { formattedMessage?: string; message?: string }) => entry.formattedMessage ?? entry.message).join("\n"));
  const deployed = output.contracts[file]?.[contractName]?.evm?.deployedBytecode;
  if (!deployed?.object) throw new Error(`no runtime bytecode for ${contractName}`);
  const immutableRanges = Object.values(deployed.immutableReferences ?? {}).flat() as Array<{ start: number; length: number }>;
  return { runtime: `0x${deployed.object}`, immutableRanges };
}

function normalizeImmutables(code: `0x${string}`, ranges: Array<{ start: number; length: number }>): `0x${string}` {
  const chars = code.slice(2).split("");
  for (const { start, length } of ranges) chars.fill("0", start * 2, (start + length) * 2);
  return `0x${chars.join("")}`;
}

async function main(): Promise<void> {
  const client = createPublicClient({ chain: baseSepolia, transport: http(getBaseRpcUrl()) });
  const chainId = await client.getChainId();
  if (chainId !== baseSepolia.id) throw new Error(`wrong chain ${chainId}`);
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error("deployment has no bytecode");
  const { runtime, immutableRanges } = compileRuntime();
  const expectedHash = keccak256(normalizeImmutables(runtime, immutableRanges));
  const deployedHash = keccak256(normalizeImmutables(code, immutableRanges));
  if (deployedHash !== expectedHash) throw new Error(`runtime bytecode mismatch: deployed=${deployedHash} expected=${expectedHash}`);

  const abi = parseAbi(["function owner() view returns (address)", "function oracle() view returns (address)", "function usdc() view returns (address)"]);
  const [owner, oracle, usdc] = await Promise.all([
    client.readContract({ address, abi, functionName: "owner" }),
    client.readContract({ address, abi, functionName: "oracle" }),
    client.readContract({ address, abi, functionName: "usdc" }),
  ]);
  if (usdc.toLowerCase() !== USDC_ADDRESS.toLowerCase()) throw new Error(`unexpected USDC ${usdc}`);
  for (const [label, actual, configured] of [
    ["owner", owner, process.env.EXPECTED_OWNER_ADDRESS],
    ["oracle", oracle, process.env.ORACLE_ADDRESS],
  ] as const) {
    if (configured && (!isAddress(configured) || actual.toLowerCase() !== configured.toLowerCase())) {
      throw new Error(`${label} mismatch: deployed=${actual} expected=${configured}`);
    }
  }
  console.log(JSON.stringify({ chainId, contractName, address, bytecodeBytes: (code.length - 2) / 2,
    normalizedRuntimeHash: deployedHash, owner, oracle, usdc }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
