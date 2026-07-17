'use client';

import { useMemo, useState } from 'react';
import { euro, type RevenueByPeriod } from '@/lib/admin/dashboard';

const PERIODS = [
  { key: '7d', label: '7D', sub: 'Last 7 days' },
  { key: '4w', label: '4W', sub: 'Last 4 weeks' },
  { key: '12m', label: '12M', sub: 'Last 12 months' },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];

const W = 620;
const H = 190;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 26;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const TEAL = 'rgb(var(--color-teal))';

/** Change chip vs the previous equal-length period. Hidden when there's no prior baseline (null). */
function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-bold ${
        up ? 'bg-emerald-50 text-emerald-700' : 'bg-coral/10 text-coral'
      }`}
    >
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      {Math.abs(pct)}%
    </span>
  );
}

/**
 * The dashboard's interactive revenue chart: a hand-drawn SVG area+line (zero deps, edge-safe, brand
 * teal) with a 7D / 4W / 12M toggle and a hover crosshair + tooltip. The numbers also live as text
 * (hero total + KPI cards), so the chart is a supplementary visualization — screen readers get a
 * labelled summary rather than per-point interaction.
 */
export function RevenueChart({ revenue }: { revenue: RevenueByPeriod }) {
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [hover, setHover] = useState<number | null>(null);
  const series = revenue[period];
  const points = series.points;
  const sub = PERIODS.find((p) => p.key === period)!.sub;

  const geo = useMemo(() => {
    const vals = points.map((p) => p.value);
    const max = Math.max(1, ...vals);
    const min = Math.min(0, ...vals); // baseline at zero so revenue reads from the floor
    const span = max - min || 1;
    const n = points.length;
    const xAt = (i: number) => PAD_L + (n > 1 ? i * (PLOT_W / (n - 1)) : PLOT_W / 2);
    const yAt = (v: number) => PAD_T + (1 - (v - min) / span) * PLOT_H;
    const pts = points.map((p, i) => [xAt(i), yAt(p.value)] as const);
    const line = pts
      .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(' ');
    const floor = PAD_T + PLOT_H;
    const area = `${line} L${xAt(n - 1).toFixed(1)} ${floor} L${xAt(0).toFixed(1)} ${floor} Z`;
    return { pts, line, area, n };
  }, [points]);

  const onMove = (clientX: number, rect: DOMRect) => {
    if (geo.n === 0) return;
    const vbx = ((clientX - rect.left) / rect.width) * W;
    const step = PLOT_W / Math.max(1, geo.n - 1);
    const i = Math.round((vbx - PAD_L) / step);
    setHover(Math.max(0, Math.min(geo.n - 1, i)));
  };

  const active = hover !== null ? geo.pts[hover] : null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-extrabold text-ink">Revenue</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">{sub}</p>
        </div>
        <div
          role="group"
          aria-label="Chart period"
          className="inline-flex rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] p-1"
        >
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={period === p.key}
              onClick={() => {
                setPeriod(p.key);
                setHover(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
                period === p.key ? 'bg-teal text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <span className="text-[30px] font-extrabold leading-none tracking-tight text-ink">
          {euro(series.totalEur)}
        </span>
        <Delta pct={series.deltaPct} />
      </div>

      <div className="relative mt-3.5" onMouseLeave={() => setHover(null)}>
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block touch-pan-y overflow-visible"
          role="img"
          aria-label={`Revenue chart, ${sub.toLowerCase()}, total ${euro(series.totalEur)}`}
          onMouseMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (t) onMove(t.clientX, e.currentTarget.getBoundingClientRect());
          }}
        >
          <path d={geo.area} fill={TEAL} fillOpacity={0.12} stroke="none" />
          <path
            d={geo.line}
            fill="none"
            stroke={TEAL}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {active && (
            <>
              <line
                x1={active[0]}
                x2={active[0]}
                y1={PAD_T}
                y2={PAD_T + PLOT_H}
                stroke={TEAL}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle
                cx={active[0]}
                cy={active[1]}
                r={4.5}
                fill={TEAL}
                stroke="#fff"
                strokeWidth={2}
              />
            </>
          )}
        </svg>

        <div className="mt-1.5 flex justify-between text-[10.5px] font-semibold text-ink-muted/70">
          {points.map((p, i) => (
            <span key={i}>{p.label}</span>
          ))}
        </div>

        {hover !== null && active && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[115%] whitespace-nowrap rounded-lg border border-[#E2E7EA] bg-white px-2.5 py-1.5 text-[12px] shadow-[0_10px_24px_-12px_rgba(10,46,54,0.5)]"
            style={{ left: `${(active[0] / W) * 100}%`, top: `${active[1]}px` }}
          >
            <span className="text-ink-muted">{points[hover]!.label}</span>{' '}
            <span className="font-extrabold text-ink">{euro(points[hover]!.value)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
