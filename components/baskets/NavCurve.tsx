/**
 * Basket NAV over time.
 *
 * Inline SVG rather than a charting dependency: this is one line and a baseline, and
 * a chart library would ship more JavaScript than the whole page needs. Colours come
 * from theme tokens so it inverts with the palette.
 */

export interface NavPoint {
  timestamp: number;
  nav: number;
}

const WIDTH = 720;
const HEIGHT = 160;
const PADDING = 8;

function formatDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(5, 10);
}

export function NavCurve({
  snapshots, initialNav,
}: { snapshots: NavPoint[]; initialNav: number }) {
  if (snapshots.length === 0) {
    return (
      <div className="border border-pv-ink/[0.1] bg-pv-surface/40 px-4 py-10 text-center text-sm text-pv-muted">
        No settled results in this window yet — the curve starts once members settle a market.
      </div>
    );
  }

  // A single point has no line to draw, but the value is still worth stating.
  const values = snapshots.map((point) => point.nav);
  const min = Math.min(initialNav, ...values);
  const max = Math.max(initialNav, ...values);
  // A flat curve would divide by zero; give it a nominal band so it renders centred.
  const span = max - min || Math.max(1, max * 0.01);

  const x = (index: number) =>
    PADDING + (index / Math.max(1, snapshots.length - 1)) * (WIDTH - PADDING * 2);
  const y = (value: number) =>
    HEIGHT - PADDING - ((value - min) / span) * (HEIGHT - PADDING * 2);

  const line = snapshots.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.nav).toFixed(1)}`).join(" ");
  const area = `${line} L${x(snapshots.length - 1).toFixed(1)},${HEIGHT - PADDING} L${x(0).toFixed(1)},${HEIGHT - PADDING} Z`;
  const last = snapshots.at(-1)!;
  const up = last.nav >= initialNav;
  const stroke = up ? "rgb(var(--pv-accent))" : "rgb(var(--pv-danger))";

  return (
    <figure className="border border-pv-ink/[0.1] bg-pv-surface/40 p-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-40 w-full"
        role="img"
        aria-label={`Basket NAV from ${initialNav.toFixed(2)} to ${last.nav.toFixed(2)} USDC across ${snapshots.length} settlement days`}
      >
        {/* Baseline: starting NAV, so gain and loss are readable without axis labels. */}
        <line
          x1={PADDING} x2={WIDTH - PADDING}
          y1={y(initialNav)} y2={y(initialNav)}
          stroke="rgb(var(--pv-ink) / 0.18)" strokeWidth="1" strokeDasharray="3 3"
        />
        <path d={area} fill={stroke} fillOpacity="0.08" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(snapshots.length - 1)} cy={y(last.nav)} r="3.5" fill={stroke} />
      </svg>
      <figcaption className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-pv-muted">
        <span>{formatDay(snapshots[0].timestamp)}</span>
        <span>
          {initialNav.toFixed(2)} → {last.nav.toFixed(2)} USDC (virtual)
        </span>
        <span>{formatDay(last.timestamp)}</span>
      </figcaption>
    </figure>
  );
}
