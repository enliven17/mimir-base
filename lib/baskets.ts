export interface BasketAgentWeight {
  agentId: string;
  weightBps: number;
  category: string;
  mode: string;
  paused?: boolean;
  stale?: boolean;
}
export interface BasketReturnPoint { timestamp: number; returnsBps: Record<string, number> }
export interface BasketPolicy { maxSingleAgentBps: number; maxCategoryBps: number; staleSignalAction: "skip" | "pause"; failedCopyAction: "keep_idle" | "pause" }
export interface BasketSnapshot { timestamp: number; navAtomic: bigint; drawdownBps: number }

export const VIRTUAL_BASKET_INITIAL_NAV_ATOMIC = 1_000_000_000n;

export function validateBasket(weights: BasketAgentWeight[], policy: BasketPolicy): string[] {
  const errors: string[] = [];
  if (weights.reduce((sum, item) => sum + item.weightBps, 0) !== 10_000) errors.push("weights_must_total_10000_bps");
  if (new Set(weights.map((item) => item.agentId)).size !== weights.length) errors.push("duplicate_agent");
  if (weights.some((item) => item.weightBps <= 0 || item.weightBps > policy.maxSingleAgentBps)) errors.push("single_agent_exposure");
  const categories = new Map<string, number>();
  for (const item of weights) categories.set(item.category, (categories.get(item.category) ?? 0) + item.weightBps);
  if ([...categories.values()].some((value) => value > policy.maxCategoryBps)) errors.push("category_exposure");
  return errors;
}

/** Read-only backtest. Missing, paused and stale signals remain idle USDC (0% return). */
export function simulateVirtualBasket(weights: BasketAgentWeight[], points: BasketReturnPoint[], initialNavAtomic = VIRTUAL_BASKET_INITIAL_NAV_ATOMIC): BasketSnapshot[] {
  let nav = initialNavAtomic;
  let high = nav;
  return [...points].sort((a, b) => a.timestamp - b.timestamp).map((point) => {
    let weightedReturn = 0n;
    for (const agent of weights) {
      if (agent.paused || agent.stale) continue;
      weightedReturn += BigInt(point.returnsBps[agent.agentId] ?? 0) * BigInt(agent.weightBps);
    }
    nav = nav + (nav * weightedReturn) / 100_000_000n;
    if (nav > high) high = nav;
    const drawdownBps = high === 0n ? 0 : Number(((high - nav) * 10_000n) / high);
    return { timestamp: point.timestamp, navAtomic: nav, drawdownBps };
  });
}

export function basketExposure(weights: BasketAgentWeight[]) {
  const categories: Record<string, number> = {};
  const modes: Record<string, number> = {};
  for (const item of weights) {
    categories[item.category] = (categories[item.category] ?? 0) + item.weightBps;
    modes[item.mode] = (modes[item.mode] ?? 0) + item.weightBps;
  }
  return { categories, modes };
}

/** Performance fee applies only to realized NAV above the previous high-water mark. */
export function highWaterMarkFee(navAtomic: bigint, highWaterMarkAtomic: bigint, performanceFeeBps: bigint) {
  if (performanceFeeBps < 0n || performanceFeeBps > 1_000n) throw new Error("performance fee cap");
  const gain = navAtomic > highWaterMarkAtomic ? navAtomic - highWaterMarkAtomic : 0n;
  const feeAtomic = (gain * performanceFeeBps) / 10_000n;
  return { feeAtomic, nextHighWaterMarkAtomic: navAtomic > highWaterMarkAtomic ? navAtomic : highWaterMarkAtomic };
}

export function sharesForDeposit(assetsAtomic: bigint, totalAssetsAtomic: bigint, totalSharesAtomic: bigint): bigint {
  if (assetsAtomic <= 0n) throw new Error("zero deposit");
  if (totalSharesAtomic === 0n) return assetsAtomic;
  if (totalAssetsAtomic <= 0n) throw new Error("invalid insolvent vault");
  return (assetsAtomic * totalSharesAtomic) / totalAssetsAtomic;
}

export function assetsForRedemption(sharesAtomic: bigint, totalAssetsAtomic: bigint, totalSharesAtomic: bigint): bigint {
  if (sharesAtomic <= 0n || totalSharesAtomic <= 0n) throw new Error("invalid redemption");
  return (sharesAtomic * totalAssetsAtomic) / totalSharesAtomic;
}
