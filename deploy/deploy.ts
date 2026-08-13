/** Clean-state Mimir/MimirV2 deployment for Base Sepolia. */
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, isAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
// solc has no bundled TypeScript declarations.
// @ts-expect-error -- compile output is checked before use.
import solc from "solc";
import { baseSepolia, getBaseRpcUrl, getExplorerAddressUrl } from "../lib/base";
import { USDC_ADDRESS } from "../lib/usdc";

type DeployName = "Mimir" | "MimirV2";
const contractName = (process.env.MIMIR_CONTRACT_NAME?.trim() || "Mimir") as DeployName;
if (!(["Mimir", "MimirV2"] as string[]).includes(contractName)) throw new Error(`unsupported MIMIR_CONTRACT_NAME ${contractName}`);
const deployAbi = contractName === "MimirV2"
  ? parseAbi(["constructor(address _oracle, address _usdc, uint16 _platformFeeBps, uint16 _agentOwnerFeeBps, address _platformRecipient)"])
  : parseAbi(["constructor(address _oracle, address _usdc)"]);

function prompt(question: string, mask = false): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return reject(new Error("No interactive terminal; set env vars directly."));
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const internal = rl as unknown as { _writeToOutput: (value: string) => void; output: NodeJS.WriteStream; line: string };
    const original = internal._writeToOutput.bind(internal);
    if (mask) internal._writeToOutput = (value) => internal.line.length > 0
      ? internal.output.write(`\r${question}${"*".repeat(internal.line.length)}`) as unknown as void
      : original(value);
    rl.question(question, (answer) => { rl.close(); if (mask) process.stdout.write("\n"); resolve(answer.trim()); });
    rl.once("SIGINT", () => { rl.close(); reject(new Error("Cancelled.")); });
  });
}

async function requiredSecret(name: string): Promise<string> {
  return process.env[name]?.trim() || prompt(`Enter ${name} (0x...): `, true);
}

function compile(): `0x${string}` {
  const file = `${contractName}.sol`;
  const source = readFileSync(path.resolve(process.cwd(), "contracts", file), "utf8");
  const output = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { [file]: { content: source } }, settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  } })));
  const errors = (output.errors ?? []).filter((entry: { severity: string }) => entry.severity === "error");
  if (errors.length) throw new Error(errors.map((entry: { formattedMessage?: string; message?: string }) => entry.formattedMessage ?? entry.message).join("\n"));
  const artifact = output.contracts[file]?.[contractName];
  if (!artifact?.evm?.bytecode?.object) throw new Error(`solc produced no ${contractName} bytecode`);
  const outDir = path.resolve(process.cwd(), "artifacts");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${contractName}.bin`), artifact.evm.bytecode.object, "utf8");
  writeFileSync(path.join(outDir, `${contractName}.abi.json`), JSON.stringify(artifact.abi, null, 2), "utf8");
  return `0x${artifact.evm.bytecode.object}`;
}

async function main() {
  const deployerKey = await requiredSecret("DEPLOYER_PRIVATE_KEY");
  const oracle = process.env.ORACLE_ADDRESS?.trim() || await prompt("Enter ORACLE_ADDRESS (0x...): ");
  const usdc = (process.env.USDC_ADDRESS?.trim() || process.env.NEXT_PUBLIC_USDC_ADDRESS?.trim() || USDC_ADDRESS) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) throw new Error("DEPLOYER_PRIVATE_KEY must be exactly 32 bytes");
  if (!isAddress(oracle) || !isAddress(usdc)) throw new Error("oracle or USDC address is invalid");
  const account = privateKeyToAccount(deployerKey as `0x${string}`);
  const platformFeeBps = Number(process.env.PLATFORM_FEE_BPS ?? 0);
  const ownerFeeBps = Number(process.env.AGENT_OWNER_FEE_BPS ?? 0);
  const recipient = (process.env.PLATFORM_FEE_RECIPIENT?.trim() || account.address) as `0x${string}`;
  if (![platformFeeBps, ownerFeeBps].every((value) => Number.isInteger(value) && value >= 0) || platformFeeBps + ownerFeeBps > 1_000) {
    throw new Error("fee bps must be non-negative integers with total <= 1000");
  }
  if (!isAddress(recipient)) throw new Error("PLATFORM_FEE_RECIPIENT is invalid");
  const args = (contractName === "MimirV2"
    ? [oracle, usdc, platformFeeBps, ownerFeeBps, recipient]
    : [oracle, usdc]) as any;
  const rpc = getBaseRpcUrl();
  const wallet = createWalletClient({ chain: baseSepolia, transport: http(rpc), account });
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const bytecode = compile();
  console.log(JSON.stringify({ contractName, chainId: baseSepolia.id, deployer: account.address, oracle, usdc,
    platformFeeBps: contractName === "MimirV2" ? platformFeeBps : undefined,
    ownerFeeBps: contractName === "MimirV2" ? ownerFeeBps : undefined,
    recipient: contractName === "MimirV2" ? recipient : undefined }, null, 2));
  const txHash = await wallet.deployContract({ abi: deployAbi, bytecode, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === "reverted" || !receipt.contractAddress) throw new Error("deployment transaction reverted");
  console.log(JSON.stringify({ txHash, contractAddress: receipt.contractAddress, deployBlock: receipt.blockNumber.toString(),
    explorer: getExplorerAddressUrl(receipt.contractAddress) }, null, 2));
  console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS=${receipt.contractAddress}`);
  console.log(`NEXT_PUBLIC_DEPLOY_BLOCK=${receipt.blockNumber}`);
  console.log(`NEXT_PUBLIC_USDC_ADDRESS=${usdc}`);
  console.log(`MIMIR_CONTRACT_NAME=${contractName}`);
}

main().catch((error) => { console.error("Deploy failed:", error instanceof Error ? error.message : error); process.exit(1); });
