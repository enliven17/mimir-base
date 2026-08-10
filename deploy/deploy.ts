/**
 * Mimir contract deployment script for Base Sepolia (USDC stakes)
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... ORACLE_ADDRESS=0x... npx tsx deploy/deploy.ts
 *
 * Optional:
 *   USDC_ADDRESS=0x...  (defaults to the official Base Sepolia USDC)
 *
 * Compiles contracts/Mimir.sol with solc, deploys, and prints env lines to paste.
 */

import { createInterface } from "readline";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  encodeDeployData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import * as path from "path";
import solc from "solc";
import { baseSepolia, getBaseRpcUrl, getExplorerAddressUrl } from "../lib/base";
import { USDC_ADDRESS } from "../lib/usdc";

const DEPLOY_ABI = parseAbi([
  "constructor(address _oracle, address _usdc)",
]);

function prompt(question: string, { mask = false } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      reject(new Error("No interactive terminal — set env vars directly."));
      return;
    }

    const rl = createInterface({
      input:  process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const mrl = rl as any;
    const origWrite = mrl._writeToOutput.bind(mrl);

    if (mask) {
      mrl._writeToOutput = (s: string) => {
        if (rl.line.length > 0) {
          mrl.output.write(`\r${question}${"*".repeat(rl.line.length)}`);
          return;
        }
        origWrite(s);
      };
    }

    rl.question(question, (answer) => {
      rl.close();
      if (mask) process.stdout.write("\n");
      resolve(answer.trim());
    });
    rl.once("SIGINT", () => { rl.close(); reject(new Error("Cancelled.")); });
  });
}

async function getKey(envVar: string, label: string): Promise<string> {
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) return fromEnv;
  return prompt(`Enter ${label} (0x...): `, { mask: true });
}

function compileMimir(): `0x${string}` {
  const sourcePath = path.resolve(process.cwd(), "contracts/Mimir.sol");
  const source = readFileSync(sourcePath, "utf-8");
  const input = {
    language: "Solidity",
    sources: {
      "Mimir.sol": { content: source },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors?.some((e: any) => e.severity === "error")) {
    const msgs = output.errors
      .filter((e: any) => e.severity === "error")
      .map((e: any) => e.formattedMessage || e.message)
      .join("\n");
    throw new Error(`solc compile failed:\n${msgs}`);
  }

  const artifact = output.contracts["Mimir.sol"]?.Mimir;
  if (!artifact?.evm?.bytecode?.object) {
    throw new Error("solc produced no Mimir bytecode");
  }

  const bin = artifact.evm.bytecode.object as string;
  const outDir = path.resolve(process.cwd(), "artifacts");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "Mimir.bin"), bin, "utf-8");
  writeFileSync(path.join(outDir, "Mimir.abi.json"), JSON.stringify(artifact.abi, null, 2), "utf-8");
  console.log("Compiled contracts/Mimir.sol → artifacts/Mimir.bin");
  return `0x${bin}` as `0x${string}`;
}

async function main() {
  const deployerKey = await getKey("DEPLOYER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY");
  const oracleAddr  = (process.env.ORACLE_ADDRESS?.trim() ||
    await prompt("Enter ORACLE_ADDRESS (0x...): ")).trim();
  const usdcAddr = (process.env.USDC_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_USDC_ADDRESS?.trim() ||
    USDC_ADDRESS) as `0x${string}`;

  if (!deployerKey.startsWith("0x")) throw new Error("Private key must start with 0x");
  if (!oracleAddr.startsWith("0x"))  throw new Error("Oracle address must start with 0x");
  if (!usdcAddr.startsWith("0x"))    throw new Error("USDC address must start with 0x");

  const account = privateKeyToAccount(deployerKey as `0x${string}`);
  const rpc     = getBaseRpcUrl();

  const wallet = createWalletClient({
    chain:     baseSepolia,
    transport: http(rpc),
    account,
  });

  const publicClient = createPublicClient({
    chain:     baseSepolia,
    transport: http(rpc),
  });

  console.log("");
  console.log("═══════════════════════════════════════");
  console.log("  Mimir Contract Deployment (USDC stakes)");
  console.log(`  Network  : Base Sepolia (${baseSepolia.id})`);
  console.log(`  RPC      : ${rpc}`);
  console.log(`  Deployer : ${account.address}`);
  console.log(`  Oracle   : ${oracleAddr}`);
  console.log(`  USDC     : ${usdcAddr}`);
  console.log("═══════════════════════════════════════\n");

  const bytecode = compileMimir();

  console.log("Deploying...");

  const deployData = encodeDeployData({
    abi: DEPLOY_ABI,
    bytecode,
    args: [oracleAddr as `0x${string}`, usdcAddr],
  });

  const txHash = await wallet.deployContract({
    abi:      DEPLOY_ABI,
    bytecode,
    args:     [oracleAddr as `0x${string}`, usdcAddr],
  });

  console.log(`Tx hash: ${txHash}`);
  console.log("Waiting for receipt...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === "reverted") {
    throw new Error("Deployment transaction reverted!");
  }

  const contractAddress = receipt.contractAddress;
  console.log("");
  console.log("✓ Mimir deployed successfully!");
  console.log(`  Contract : ${contractAddress}`);
  console.log(`  Block    : ${receipt.blockNumber}`);
  console.log(`  Explorer : ${getExplorerAddressUrl(contractAddress!)}`);
  console.log("");
  console.log("Add to .env.local:");
  console.log(`  NEXT_PUBLIC_CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`  NEXT_PUBLIC_DEPLOY_BLOCK=${receipt.blockNumber}`);
  console.log(`  NEXT_PUBLIC_USDC_ADDRESS=${usdcAddr}`);
  console.log("");
  console.log("Verify   : npx hardhat verify / basescan UI — record the deploy block above.");
  console.log("Then: npm run agents:fund  (USDC + gas) and npm run workers");
  void deployData; // keep encode for debugging if needed
}

main().catch((err) => {
  console.error("Deploy failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
