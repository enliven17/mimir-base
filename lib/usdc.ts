/**
 * Base Sepolia USDC (ERC-20, 6 decimals) — the single Mimir asset.
 *
 * Market stakes, payouts, agent bankrolls and x402 payments are all denominated
 * in this token. Gas remains native ETH.
 *
 * Official address list:
 * https://developers.circle.com/stablecoins/usdc-contract-addresses
 */
import { parseAbi } from "viem";

/** Circle's official Base Sepolia USDC. */
export const USDC_ADDRESS =
  (process.env.NEXT_PUBLIC_USDC_ADDRESS?.trim() as `0x${string}` | undefined) ||
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export const USDC_DECIMALS = 6;
export const USDC_SYMBOL = "USDC";

/** 1 USDC in atomic units. */
export const USDC_UNIT = 1_000_000n;

/** Minimum stake in display USDC — matches Mimir.sol MIN_STAKE = 2 * 10^6 */
export const MIN_STAKE_USDC = 2;

export const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
]);

/**
 * Convert display USDC to atomic units (6 decimals).
 * Supports up to 6 fractional digits.
 */
export function usdcToUnits(usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc < 0) throw new Error("Invalid USDC amount");
  return BigInt(Math.round(usdc * 1_000_000));
}

/** Convert atomic units to display USDC. */
export function unitsToUsdc(units: bigint | number): number {
  return Number(BigInt(units)) / 1_000_000;
}

export function formatUsdcAmount(units: bigint | number, decimals = 2): string {
  return unitsToUsdc(units).toFixed(decimals) + " USDC";
}
