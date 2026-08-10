/**
 * BOT Chain Testnet USDT (ERC-20, 6 decimals).
 *
 * Gas remains native BOT. Market stakes, payouts, and agent bankrolls for
 * create/challenge use this token.
 *
 * Official listing:
 * https://dev-docs.bohr.life/docs/Bridge/contract-addresses/
 */
import { parseAbi } from "viem";

/** BOT Chain Testnet USDT */
export const USDT_ADDRESS =
  (process.env.NEXT_PUBLIC_USDT_ADDRESS?.trim() as `0x${string}` | undefined) ||
  "0x75edC9335175Fc0552D51D48439F229c10420fe3";

export const USDT_DECIMALS = 6;
export const USDT_SYMBOL = "USDT";

/** Minimum stake in display USDT — matches Mimir.sol MIN_STAKE = 2 * 10^6 */
export const MIN_STAKE_USDT = 2;

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
 * Convert display USDT to on-chain units (6 decimals).
 * Supports up to 6 fractional digits.
 */
export function usdtToUnits(usdt: number): bigint {
  if (!Number.isFinite(usdt) || usdt < 0) throw new Error("Invalid USDT amount");
  return BigInt(Math.round(usdt * 1_000_000));
}

/** Convert on-chain units to display USDT. */
export function unitsToUsdt(units: bigint | number): number {
  return Number(BigInt(units)) / 1_000_000;
}

export function formatUsdtAmount(units: bigint | number, decimals = 2): string {
  return unitsToUsdt(units).toFixed(decimals) + " USDT";
}
