'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { PlannerPoint } from './planner-constants';

function PinGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-teal">
      <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11Z" stroke="currentColor" strokeWidth={1.7} />
      <circle cx="12" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

/**
 * Type-to-search location field for the planner pickup + drop-off. Shows the curated bases as quick
 * picks when empty, then live Google places (via /api/planner/places?q=) as the customer types.
 * Selecting one returns a {@link PlannerPoint} (name + coords) so it can be pinned on the map and the
 * route re-drawn. Controlled: `value` is the current selection (null = nothing chosen yet).
 */
export function PickupSearch({
  value,
  onChange,
  presets = [],
  placeholder = 'Search a location',
  dotClassName = 'bg-ink',
}: {
  value: PlannerPoint | null;
  onChange: (point: PlannerPoint) => void;
  presets?: PlannerPoint[];
  placeholder?: string;
  /** Colour of the leading location dot (pickup = ink, drop-off = coral). */
  dotClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlannerPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside the field.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Debounced live search (≥2 chars).
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/planner/places?q=${encodeURIComponent(q)}`).then((r) => r.json());
        if (!active) return;
        setResults(res.ok && Array.isArray(res.data) ? (res.data as PlannerPlace[]).slice(0, 6) : []);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 280);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query, open]);

  function pick(point: PlannerPoint) {
    onChange(point);
    setOpen(false);
    setQuery('');
  }

  const showPresets = query.trim().length < 2;

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2.5 rounded-[11px] border border-[#E6EFEE] bg-[#F4F8F7] px-[11px] py-[9px]">
        <span className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full ${dotClassName}`}>
          <span className="h-[7px] w-[7px] rounded-full bg-white" />
        </span>
        <input
          value={open ? query : value?.name ?? ''}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          placeholder={value?.name ?? placeholder}
          aria-label="Search a location"
          className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] font-semibold text-ink outline-none placeholder:font-semibold placeholder:text-ink/70"
        />
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-ink-muted">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-64 overflow-y-auto rounded-[12px] border border-[#E6EFEE] bg-white p-1.5 shadow-[0_18px_40px_-18px_rgba(10,46,54,.4)]">
          {showPresets ? (
            <>
              {presets.length > 0 && (
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
                  Popular pick-ups
                </div>
              )}
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                  className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-semibold text-ink hover:bg-teal-tint"
                >
                  <PinGlyph />
                  {p.name}
                </button>
              ))}
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-ink-muted">Or type a hotel, town or place…</div>
            </>
          ) : loading ? (
            <div className="px-2.5 py-3 text-[12.5px] text-ink-muted">Searching…</div>
          ) : results.length ? (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })}
                className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left hover:bg-teal-tint"
              >
                <PinGlyph />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-muted">
                    {p.region}
                    {p.category ? ` · ${p.category}` : ''}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="px-2.5 py-3 text-[12.5px] text-ink-muted">No matches — try a nearby town or hotel name.</div>
          )}
        </div>
      )}
    </div>
  );
}
