'use client';

import { useMemo, useState } from 'react';
import type { PlannerPlace } from '@/lib/validation/planner';
import { PLACE_CATEGORIES, PLACE_REGIONS, ratingFor } from './planner-constants';
import { Thumb } from './Thumb';

/** Slide-in "Add places" panel — search + category/region filters over the curated set. Overlays the
 *  middle pane (desktop) or the single pane (mobile); the design renders it absolutely within its host. */
export function PlacesDrawer({
  open,
  onClose,
  places,
  selectedIds,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  places: PlannerPlace[];
  selectedIds: string[];
  onAdd: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('All');
  const [region, setRegion] = useState('All');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  // Show only categories that actually have places (keeps the design's order, drops empty chips).
  const cats = useMemo(() => {
    const present = new Set(places.map((p) => p.category));
    return PLACE_CATEGORIES.filter((c) => c === 'All' || present.has(c));
  }, [places]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return places.filter(
      (p) =>
        (cat === 'All' || p.category === cat) &&
        (region === 'All' || p.region === region) &&
        (!needle || `${p.name}${p.blurb ?? ''}${p.category}`.toLowerCase().includes(needle)),
    );
  }, [places, search, cat, region]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-30 flex animate-drawer-up flex-col bg-white">
      <div className="flex items-center gap-2.5 border-b border-[#EEF4F3] px-[15px] py-[13px]">
        <div>
          <div className="font-display text-[17px] font-semibold text-ink">Add places</div>
          <div className="text-xs text-ink-muted">{filtered.length} spots · grounded data</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[10px] border border-[#EEF4F3] bg-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="#51666B" strokeWidth={2} strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="px-[15px] pt-3">
        <div className="mb-2.5 flex items-center gap-2.5 rounded-xl border border-[#E6EFEE] bg-[#F4F8F7] px-3 py-[9px]">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx={11} cy={11} r={7} stroke="#51666B" strokeWidth={1.8} />
            <path d="M16.5 16.5 21 21" stroke="#51666B" strokeWidth={1.8} strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search beaches, waterfalls, viewpoints…"
            aria-label="Search places"
            className="min-w-0 flex-1 border-none bg-transparent text-sm text-ink outline-none"
          />
        </div>
        <div className="no-bar mb-0.5 flex gap-[7px] overflow-x-auto pb-[9px]">
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={`shrink-0 cursor-pointer rounded-full border px-[13px] py-[7px] text-[12.5px] font-bold ${
                cat === c ? 'border-teal bg-teal text-white' : 'border-[#E3EEEC] bg-white text-teal-dark'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="no-bar flex gap-[7px] overflow-x-auto pb-2.5">
          {PLACE_REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              className={`shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${
                region === r ? 'border-[#E3CFA0] bg-[#FFF8EC] text-[#7A5A12]' : 'border-[#EEF1F0] bg-white text-ink-muted'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-2.5 overflow-y-auto px-[15px] pb-4 pt-1">
        {filtered.length === 0 ? (
          <div className="py-[30px] text-center text-[13.5px] text-ink-muted">No places match — try clearing a filter.</div>
        ) : (
          filtered.map((p) => {
            const added = selected.has(p.id);
            return (
              <div key={p.id} className="flex gap-3 rounded-[14px] border border-[#EAF2F1] bg-white p-2.5 shadow-[0_3px_10px_rgba(10,46,54,.04)]">
                <Thumb place={p} size={64} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-[7px]">
                    <strong className="text-[14.5px] text-ink">{p.name}</strong>
                    <span className="inline-flex items-center gap-[3px] text-[11.5px] font-bold text-gold">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="#F5A623" aria-hidden>
                        <path d="M12 2l2.6 6.3L21 9l-5 4.3L17.5 21 12 17.2 6.5 21 8 13.3 3 9l6.4-.7L12 2Z" />
                      </svg>
                      {ratingFor(p)}
                    </span>
                  </div>
                  {p.blurb && <p className="m-0 mb-[7px] mt-1 text-[12.5px] leading-[1.4] text-ink-muted">{p.blurb}</p>}
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-[7px] bg-teal-tint px-[7px] py-[3px] text-[11px] font-bold text-teal">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M5 13l4 4L19 7" stroke="#0E8C92" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Real place · open today
                    </span>
                    <span className="text-[11.5px] font-semibold text-ink-muted">{p.region}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onAdd(p.id)}
                  disabled={added}
                  aria-label={`Add ${p.name}`}
                  className={`shrink-0 self-center rounded-[10px] px-3.5 py-[9px] text-[13px] font-bold ${
                    added ? 'cursor-default bg-[#EAF2F1] text-ink-muted' : 'cursor-pointer bg-coral text-white'
                  }`}
                >
                  {added ? '✓ Added' : '+ Add'}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
