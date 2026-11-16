'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { Panel, Segmented, StatusChip } from '@/components/admin/ui';
import { euro, type RevenueByPeriod } from '@/lib/admin/dashboard';
import { RollingNumber } from '@/components/admin/today/RollingNumber';
import { TODAY_LIFT } from '@/components/admin/today/MetricCard';
import { IconWallet } from '@/components/ui/icons';

const PERIODS = [
  { value: '7d', label: '7 days', sub: 'Last 7 days', before: 'the 7 days before' },
  { value: '4w', label: '4 weeks', sub: 'Last 4 weeks', before: 'the 4 weeks before' },
  { value: '12m', label: '12 months', sub: 'Last 12 months', before: 'the 12 months before' },
] as const;
type PeriodKey = (typeof PERIODS)[number]['value'];

const W = 620;
const H = 180;
const PAD_T = 10;
const PAD_B = 6;
const PLOT_H = H - PAD_T - PAD_B;
const TEAL = 'rgb(var(--color-teal))';
const SOFT = 'rgb(var(--color-ink-soft))';
const GRID = 'rgb(var(--color-line-soft))';

/** A rounded top for the scale, so the gridlines read as plain numbers (€0, €500, €1,000). */
function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

/** The change against the period before; nothing when that period took nothing (no invented %). */
function Delta({ pct, before }: { pct: number | null; before: string }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <StatusChip tone={up ? 'ok' : 'bad'}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
      {Math.abs(pct)}% against {before}
    </StatusChip>
  );
}

/**
 * "Money in": the money taken on bookings made in each day, week or month (Σ paid − refunded, the
 * dashboard's own figure), as one clean line, with the period before as a dashed line beneath it and
 * a read-out of both on hover, touch or the arrow keys. Only money actually taken — no forecast and
 * no "likely range": nothing in the system computes one.
 */
export function RevenueChart({ revenue }: { revenue: RevenueByPeriod }) {
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [hover, setHover] = useState<number | null>(null);
  const series = revenue[period];
  const points = series.points;
  const meta = PERIODS.find((p) => p.value === period)!;
  const hasBefore = series.previous.some((v) => v > 0);
  // Nothing taken in this period or the one before: one line, not a tall chart of a flat zero.
  const quiet = series.totalEur === 0 && !hasBefore && points.every((p) => p.value === 0);

  const geo = useMemo(() => {
    const max = niceMax(Math.max(0, ...points.map((p) => p.value), ...series.previous));
    const n = points.length;
    const xAt = (i: number) => (n > 1 ? (i * W) / (n - 1) : W / 2);
    const yAt = (v: number) => PAD_T + (1 - Math.max(0, v) / max) * PLOT_H;
    const path = (vals: readonly number[]) =>
      vals.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(' ');
    const line = path(points.map((p) => p.value));
    const floor = PAD_T + PLOT_H;
    const area = `${line} L${xAt(n - 1).toFixed(1)} ${floor} L${xAt(0).toFixed(1)} ${floor} Z`;
    return {
      n,
      max,
      xAt,
      yAt,
      line,
      area,
      before: path(series.previous),
      grid: [0, 0.5, 1].map((f) => ({ f, y: yAt(max * f), label: euro(max * f) })),
    };
  }, [points, series.previous]);

  const onMove = (clientX: number, rect: DOMRect) => {
    if (geo.n === 0) return;
    const f = (clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(geo.n - 1, Math.round(f * (geo.n - 1)))));
  };

  const at = hover !== null ? points[hover] : undefined;
  const x = hover !== null ? geo.xAt(hover) : 0;

  return (
    <Panel
      title="Money in"
      meta={meta.sub}
      className={TODAY_LIFT}
      style={{ '--i': 7 } as CSSProperties}
      actions={
        <Segmented
          label="Chart period"
          options={PERIODS.map(({ value, label }) => ({ value, label }))}
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setHover(null);
          }}
        />
      }
    >
      <div className="px-4 pb-3 pt-3.5">
        {quiet ? (
          <div className="flex items-center gap-3 rounded-xl bg-[#FAFBFB] px-3.5 py-3">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-tint text-teal-dark"
            >
              <IconWallet width={16} height={16} />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink">
                Nothing taken in the {meta.sub.toLowerCase()}
              </span>
              <span className="block text-[12px] text-ink-soft">
                Money taken on new bookings shows here as it comes in.
              </span>
            </span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <RollingNumber
                key={`${period}-${series.totalEur}`}
                value={euro(series.totalEur)}
                className="text-[26px] font-bold tracking-[-0.02em] text-ink"
              />
              <Delta pct={series.deltaPct} before={meta.before} />
            </div>
            <p className="mt-1 text-[12px] text-ink-soft">
              Taken on bookings made in this period, refunds taken off.
            </p>

            {/* Room above the plot for the read-out pill. */}
            <div className="relative mt-10 pl-12">
              <div
                className="relative rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-dark"
                tabIndex={0}
                role="group"
                aria-label={`Money in, ${meta.sub.toLowerCase()}: ${euro(series.totalEur)}. Use the left and right arrow keys to read each ${period === '12m' ? 'month' : period === '4w' ? 'week' : 'day'}.`}
                onMouseLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  const step = e.key === 'ArrowRight' ? 1 : -1;
                  setHover((h) =>
                    Math.max(0, Math.min(geo.n - 1, (h ?? (step > 0 ? -1 : geo.n)) + step)),
                  );
                }}
              >
                {/* The scale, as text beside the plot so it never stretches with the SVG. */}
                {geo.grid.map((g) => (
                  <span
                    key={g.f}
                    aria-hidden="true"
                    className="absolute right-full mr-1.5 w-11 -translate-y-1/2 text-right text-[10.5px] tabular-nums text-ink-soft"
                    style={{ top: `${(g.y / H) * 100}%` }}
                  >
                    {g.label}
                  </span>
                ))}
                <svg
                  width="100%"
                  height={H}
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  className="block touch-pan-y overflow-visible"
                  aria-hidden="true"
                  onMouseMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
                  onTouchMove={(e) => {
                    const t = e.touches[0];
                    if (t) onMove(t.clientX, e.currentTarget.getBoundingClientRect());
                  }}
                >
                  {geo.grid.map((g) => (
                    <line
                      key={g.f}
                      x1={0}
                      x2={W}
                      y1={g.y}
                      y2={g.y}
                      stroke={GRID}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {hasBefore && (
                    <path
                      d={geo.before}
                      fill="none"
                      stroke={SOFT}
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <path d={geo.area} fill={TEAL} fillOpacity={0.08} stroke="none" />
                  <path
                    d={geo.line}
                    fill="none"
                    stroke={TEAL}
                    strokeWidth={2.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {at && (
                    <line
                      x1={x}
                      x2={x}
                      y1={PAD_T}
                      y2={PAD_T + PLOT_H}
                      stroke={SOFT}
                      strokeWidth={1}
                      strokeDasharray="2 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
                {/* Dots as HTML, so they stay round however wide the plot is drawn. */}
                {at && hover !== null && (
                  <>
                    {hasBefore && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ink-soft"
                        style={{
                          left: `${(x / W) * 100}%`,
                          top: `${(geo.yAt(series.previous[hover] ?? 0) / H) * 100}%`,
                        }}
                      />
                    )}
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-teal"
                      style={{
                        left: `${(x / W) * 100}%`,
                        top: `${(geo.yAt(at.value) / H) * 100}%`,
                      }}
                    />
                    <span
                      role="status"
                      className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-full bg-ink px-3 py-1 text-[12px] text-white"
                      style={{
                        left: `${(x / W) * 100}%`,
                        transform: `translate(${hover === 0 ? '0' : hover === geo.n - 1 ? '-100%' : '-50%'}, calc(-100% - 6px))`,
                      }}
                    >
                      <span className="font-semibold">{at.label}</span> · {euro(at.value)}
                      {hasBefore && (
                        <span className="text-white/80">
                          {' '}
                          | {euro(series.previous[hover] ?? 0)} before
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>
              <div
                aria-hidden="true"
                className="mt-1.5 flex justify-between text-[10.5px] font-semibold text-ink-soft"
              >
                {points.map((p, i) => (
                  <span key={i}>{p.label}</span>
                ))}
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-soft">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-0.5 w-4 rounded bg-teal" />
                This period
              </span>
              {hasBefore && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="w-4 border-t-2 border-dashed border-ink-soft"
                  />
                  The period before
                </span>
              )}
            </div>

            {/* The same figures as a table, for a screen reader. `sr-only` sits on a div around it,
                never on the table: a table ignores the 1px size and the overflow clip, so it stayed
                full size below the chart and made the whole back office scroll past its own shell
                (tests/unit/sr-only-table.test.ts). */}
            <div className="sr-only">
              <table>
                <caption>Money in, {meta.sub.toLowerCase()}</caption>
                <thead>
                  <tr>
                    <th scope="col">Period</th>
                    <th scope="col">Taken</th>
                    {hasBefore && <th scope="col">The period before</th>}
                  </tr>
                </thead>
                <tbody>
                  {points.map((p, i) => (
                    <tr key={i}>
                      <th scope="row">{p.label}</th>
                      <td>{euro(p.value)}</td>
                      {hasBefore && <td>{euro(series.previous[i] ?? 0)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
