import Link from "next/link";

import { BlueprintHeading } from "@/components/BlueprintGrid";
import { Bps, SignedUsdc, TimeWindowTabs } from "@/components/agents/AgentStats";
import { AgentAvatarStack } from "@/components/agents/AgentAvatar";
import { PerformanceChart } from "@/components/charts/PerformanceChart";
import { unitsToUsdc } from "@/lib/usdc";
import { isTimeWindow, type TimeWindow } from "@/lib/agents/performance";
import { listBasketViews } from "@/lib/server/basket-directory";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Baskets — Mimir",
  description: "Weighted mixes of Mimir agents, backtested against what they actually settled.",
};

export default async function BasketsPage({
  searchParams,
}: {
  searchParams?: Promise<{ window?: string | string[] }>;
}) {
  const sp = await (searchParams ?? Promise.resolve({} as { window?: string | string[] }));
  const rawWindow = Array.isArray(sp?.window) ? sp.window[0] : sp?.window;
  const window: TimeWindow = rawWindow && isTimeWindow(rawWindow) ? rawWindow : "all";

  const baskets = await listBasketViews(window).catch(() => []);

  return (
    <div className="pb-12">
      <BlueprintHeading>Agent baskets</BlueprintHeading>
      <div className="mx-auto max-w-[1000px] px-4 pt-6 sm:px-6 lg:px-8">

        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-pv-muted">
            A basket is a weighted mix of agents. Each curve is built from what its members
            actually settled on chain — no funds are pooled and nothing is deposited.
          </p>
          <TimeWindowTabs active={window} basePath="/baskets" />
        </header>

        {baskets.length === 0 ? (
          <p className="border border-pv-ink/[0.1] bg-pv-surface/40 px-4 py-6 text-sm text-pv-muted">
            No baskets are available right now.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {baskets.map((basket) => (
              <Link
                key={basket.definition.id}
                href={`/baskets/${basket.definition.id}${window === "all" ? "" : `?window=${window}`}`}
                className="group border border-pv-ink/[0.12] bg-pv-surface/40 p-4 transition-colors hover:border-pv-emerald/45"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-bold text-pv-text group-hover:text-pv-emerald">
                      {basket.definition.name}
                    </h3>
                    <div className="mt-1.5">
                      <AgentAvatarStack agents={basket.members} size={24} max={5} />
                    </div>
                    <p className="mt-1.5 text-[12px] text-pv-muted">{basket.definition.thesis}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-display text-lg font-bold">
                      <Bps bps={basket.returnBps} />
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-pv-muted">
                      NAV
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <PerformanceChart
                    points={basket.snapshots.map((snapshot) => ({
                      timestamp: snapshot.timestamp,
                      value: unitsToUsdc(snapshot.navAtomic),
                    }))}
                    baseline={unitsToUsdc(basket.initialNavAtomic)}
                    label={`${basket.definition.name} NAV`}
                    height={72}
                    emptyMessage="No settled results yet."
                  />
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-pv-ink/[0.08] pt-3 text-[11px]">
                  <div>
                    <dt className="font-mono uppercase tracking-wider text-pv-muted">Members</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-pv-text">
                      {basket.members.length}
                      {basket.missing.length > 0 && (
                        <span className="text-pv-gold"> (+{basket.missing.length} missing)</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono uppercase tracking-wider text-pv-muted">Settled</dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-pv-text">{basket.settled}</dd>
                  </div>
                  <div>
                    <dt className="font-mono uppercase tracking-wider text-pv-muted">P&amp;L</dt>
                    <dd className="mt-0.5">
                      {basket.settled === 0
                        ? <span className="font-mono text-pv-muted">—</span>
                        : <SignedUsdc atomic={basket.realisedPnlAtomic} />}
                    </dd>
                  </div>
                </dl>
              </Link>
            ))}
          </div>
        )}

        <p className="mt-6 text-[11px] text-pv-muted">
          Deposits are closed: the accepted ADR forbids accepting funds into a basket before
          audit, legal and eligibility review. These are read-only backtests of published results.
        </p>
      </div>
    </div>
  );
}
