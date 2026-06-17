'use client';

import { useMemo, useState } from 'react';
import type { PlannerPlace } from '@/lib/validation/planner';

const REGIONS = ['All', 'North', 'South', 'East', 'West', 'Central'];

/**
 * A slide-over to browse the curated places and add them to the day. Filter by region + free text;
 * each card toggles in/out of the itinerary. Backed by the same curated set the co-pilot plans from,
 * so a hand-built day and an AI-built day draw on exactly the same places.
 */
export function PlacesDrawer({
  open,
  onClose,
  places,
  selectedIds,
  onAdd,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  places: PlannerPlace[];
  selectedIds: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [region, setRegion] = useState('All');
  const [q, setQ] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return places.filter((p) => {
      if (region !== 'All' && p.region !== region) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.category.toLowerCase().includes(needle) ||
        (p.blurb ?? '').toLowerCase().includes(needle)
      );
    });
  }, [places, region, q]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-ink/40 transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden
      />
      {/* Panel */}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-cream shadow-xl transition-transform ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="Browse places"
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-ink/10 bg-white px-4 py-3">
          <div>
            <p className="font-display text-lg text-ink">Browse places</p>
            <p className="text-xs text-ink-muted">{filtered.length} curated spots</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-ink/15 px-3 py-1 text-sm text-ink hover:bg-ink/5"
          >
            Done
          </button>
        </header>

        <div className="space-y-2 border-b border-ink/10 bg-white px-4 py-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search beaches, waterfalls, markets…"
            className="w-full rounded-full border border-ink/15 px-4 py-2 text-sm text-ink outline-none focus:border-teal"
          />
          <div className="flex flex-wrap gap-1.5">
            {REGIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRegion(r)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  region === r
                    ? 'bg-teal text-white'
                    : 'border border-ink/15 text-ink-muted hover:bg-ink/5'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {filtered.length === 0 && (
            <p className="px-1 py-6 text-center text-sm text-ink-muted">No places match that search.</p>
          )}
          {filtered.map((p) => {
            const isIn = selected.has(p.id);
            return (
              <div
                key={p.id}
                className="flex items-start gap-3 rounded-card border border-ink/10 bg-white p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-ink">{p.name}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {p.category} · {p.region} · ~{Math.round(p.durationMin / 30) / 2}h
                    {p.closesAt ? ` · closes ${p.closesAt}` : ''}
                  </p>
                  {p.blurb && <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{p.blurb}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => (isIn ? onRemove(p.id) : onAdd(p.id))}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    isIn
                      ? 'bg-teal/10 text-teal-dark'
                      : 'bg-coral text-white hover:brightness-105'
                  }`}
                >
                  {isIn ? '✓ Added' : '+ Add'}
                </button>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
