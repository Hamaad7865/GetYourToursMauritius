'use client';

import type { PlannerPlace } from '@/lib/validation/planner';
import type { RouteLeg } from '@/lib/maps/haversine';

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * The day's ordered stops with the estimated drive between each (haversine fallback — the map draws
 * the real road route; the booking re-times it server-side). Reorder with ↑/↓, remove, and a soft
 * warning when a day has too many places. Empty state nudges to chat or browse.
 */
export function ItineraryPanel({
  stops,
  legs,
  warning,
  totalDriveMin,
  totalVisitMin,
  onRemove,
  onMove,
  onOpenDrawer,
  onClear,
}: {
  stops: PlannerPlace[];
  legs: RouteLeg[];
  warning: string | null;
  totalDriveMin: number;
  totalVisitMin: number;
  onRemove: (id: string) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onOpenDrawer: () => void;
  onClear: () => void;
}) {
  return (
    <section className="rounded-card border border-ink/10 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-ink/10 px-4 py-3">
        <div>
          <h2 className="font-display text-lg text-ink">Your day</h2>
          {stops.length > 0 && (
            <p className="text-xs text-ink-muted">
              {stops.length} {stops.length === 1 ? 'stop' : 'stops'} · ~{fmtDuration(totalDriveMin)}{' '}
              driving · ~{fmtDuration(totalVisitMin)} exploring
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {stops.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-ink-muted underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onOpenDrawer}
            className="rounded-full bg-teal px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-dark"
          >
            + Add places
          </button>
        </div>
      </header>

      {warning && (
        <p className="mx-4 mt-3 rounded-xl bg-gold/15 px-3 py-2 text-sm text-ink">⚠ {warning}</p>
      )}

      {stops.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm text-ink-muted">
            Your day is empty. Ask the co-pilot for a plan, or{' '}
            <button type="button" onClick={onOpenDrawer} className="font-semibold text-teal underline">
              browse places
            </button>
            .
          </p>
        </div>
      ) : (
        <ol className="px-4 py-3">
          {stops.map((p, i) => (
            <li key={p.id}>
              <div className="flex items-start gap-3 py-2">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{p.name}</p>
                  <p className="text-xs text-ink-muted">
                    {p.category} · {p.region} · ~{fmtDuration(p.durationMin)}
                    {p.closesAt ? ` · closes ${p.closesAt}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMove(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${p.name} earlier`}
                    className="grid h-7 w-7 place-items-center rounded-full border border-ink/15 text-ink disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(i, 1)}
                    disabled={i === stops.length - 1}
                    aria-label={`Move ${p.name} later`}
                    className="grid h-7 w-7 place-items-center rounded-full border border-ink/15 text-ink disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(p.id)}
                    aria-label={`Remove ${p.name}`}
                    className="grid h-7 w-7 place-items-center rounded-full border border-ink/15 text-coral hover:bg-coral/10"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {i < stops.length - 1 && legs[i] && (
                <div className="ml-3.5 flex items-center gap-2 border-l-2 border-dashed border-ink/15 py-1 pl-5 text-xs text-ink-muted">
                  <span aria-hidden>🚗</span> ~{fmtDuration(legs[i]!.minutes)} · {legs[i]!.km} km
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
