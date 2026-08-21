import { base, baseSepolia } from "@account-kit/infra";
import type { Chain } from "viem";

export const DEFAULT_OFFERING_NAME = "mimir_market_intelligence";

/** ACP uses Base mainnet by default; Base Sepolia remains available for demos. */
export function virtualsChain(): Chain {
  const chainId = Number(process.env.VIRTUALS_ACP_CHAIN_ID ?? "8453");
  if (chainId === base.id) return base;
  if (chainId === baseSepolia.id) return baseSepolia;
  throw new Error(
    `Unsupported VIRTUALS_ACP_CHAIN_ID=${chainId}; use Base (8453) or Base Sepolia (84532)`,
  );
}

export function requireVirtualsEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

export function optionalVirtualsEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function shortAddress(value: string): string {
  return value.startsWith("0x") && value.length > 12
    ? `${value.slice(0, 6)}…${value.slice(-4)}`
    : value;
}
