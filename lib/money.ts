/**
 * Canonical stake display formatting (USDT, 6 decimals on-chain).
 * All UI money rendering for markets goes through here.
 */

function trimFixed(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

/** Full display string with unit: "1,234.56 USDT", "<0.000001 USDT", "0 USDT". */
export function formatUsdt(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0 USDT";
  const abs = Math.abs(value);
  if (abs < 0.000001) return "<0.000001 USDT";
  if (abs < 1) return `${trimFixed(value, 6)} USDT`;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDT`;
}

/** Bare number ("1,234.56", "12") for layouts that render the unit separately. */
export function formatUsdtBare(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
}

/**
 * @deprecated Use formatUsdt — stakes are USDT. Kept so older call sites keep working.
 */
export function formatBot(value: number): string {
  return formatUsdt(value);
}

/** @deprecated Use formatUsdtBare */
export function formatBotBare(amount: number): string {
  return formatUsdtBare(amount);
}
