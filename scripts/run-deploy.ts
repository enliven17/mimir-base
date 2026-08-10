/**
 * Deploy Mimir with oracle as deployer (keys from .env.local).
 * Strips inline comments from env values, then writes contract address back.
 *
 *   npx tsx --env-file=.env.local scripts/run-deploy.ts
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";

function clean(raw: string): string {
  return raw.split(/\s+#/)[0].trim();
}

function loadEnvLocal(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(".env.local")) return map;
  for (const line of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    map.set(m[1], clean(m[2]));
  }
  return map;
}

function upsertEnvLocal(entries: Record<string, string>) {
  let text = existsSync(".env.local") ? readFileSync(".env.local", "utf-8") : "";
  for (const [name, value] of Object.entries(entries)) {
    const re = new RegExp(`^${name}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${name}=${value}`);
    else text += `${text.endsWith("\n") || text.length === 0 ? "" : "\n"}${name}=${value}\n`;
  }
  writeFileSync(".env.local", text, "utf-8");
}

const envMap = loadEnvLocal();
const oracleKey = envMap.get("ORACLE_PRIVATE_KEY") ?? "";
const oracleAddr =
  envMap.get("SELLER_ADDRESS") ||
  "0xFD54d1F9ce18484eA2b7977eAF4d5f24D17437F8";
const usdc =
  envMap.get("NEXT_PUBLIC_USDC_ADDRESS") ||
  envMap.get("USDC_ADDRESS") ||
  "0x75edC9335175Fc0552D51D48439F229c10420fe3";

if (!/^0x[0-9a-fA-F]{64}$/.test(oracleKey)) {
  console.error("ORACLE_PRIVATE_KEY missing/invalid in .env.local");
  process.exit(1);
}

// Ensure deploy script sees clean keys
const env = {
  ...process.env,
  DEPLOYER_PRIVATE_KEY: oracleKey,
  ORACLE_ADDRESS: oracleAddr,
  ORACLE_PRIVATE_KEY: oracleKey,
  USDC_ADDRESS: usdc,
  NEXT_PUBLIC_USDC_ADDRESS: usdc,
};

console.log("Deploying Mimir…");
console.log(`  Oracle  : ${oracleAddr}`);
console.log(`  USDC    : ${usdc}`);

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", "deploy/deploy.ts"],
  { env, encoding: "utf-8", shell: true }
);

process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// Parse contract address + block from deploy output
const out = `${result.stdout || ""}\n${result.stderr || ""}`;
const addrMatch = out.match(/NEXT_PUBLIC_CONTRACT_ADDRESS=(0x[0-9a-fA-F]{40})/);
const blockMatch = out.match(/NEXT_PUBLIC_DEPLOY_BLOCK=(\d+)/);
// Also match "Contract : 0x..."
const addrMatch2 = out.match(/Contract\s*:\s*(0x[0-9a-fA-F]{40})/i);
const blockMatch2 = out.match(/Block\s*:\s*(\d+)/i);

const contract = addrMatch?.[1] || addrMatch2?.[1];
const block = blockMatch?.[1] || blockMatch2?.[1];

if (!contract) {
  console.error("Could not parse contract address from deploy output");
  process.exit(1);
}

const updates: Record<string, string> = {
  NEXT_PUBLIC_CONTRACT_ADDRESS: contract,
  NEXT_PUBLIC_USDC_ADDRESS: usdc,
  SELLER_ADDRESS: oracleAddr,
};
if (block) updates.NEXT_PUBLIC_DEPLOY_BLOCK = block;

upsertEnvLocal(updates);
console.log("\n✓ .env.local updated:");
for (const [k, v] of Object.entries(updates)) console.log(`  ${k}=${v}`);
