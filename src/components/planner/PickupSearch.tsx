'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { PlannerPoint } from './planner-constants';
import { useT } from '@/components/site/PreferencesProvider';

function PinGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="shrink-0 text-teal"
    >
      <path
        d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11Z"
        stroke="currentColor"
        strokeWidth={1.7}
      />
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
  onUseMyLocation,
  locating = false,
  locateError = null,
}: {
  value: PlannerPoint | null;
  onChange: (point: PlannerPoint) => void;
  presets?: PlannerPoint[];
  placeholder?: string;
  /** Colour of the leading location dot (pickup = ink, drop-off = coral). */
  dotClassName?: string;
  /** Offers the "Use my current location" control. Omitted entirely for the drop-off field, and for
   *  visitors Cloudflare places outside Mauritius — they never see it and are never prompted. */
  onUseMyLocation?: () => void;
  /** A detection is in flight (disables the control + announces politely). */
  locating?: boolean;
  /** Why the last explicit attempt failed, already translated. Announced as an alert. */
  locateError?: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlannerPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set immediately before a programmatic focus() so the resulting focus event does NOT reopen the
  // dropdown and blank the field — onFocus otherwise clears `query`, which would hide the value we
  // just resolved. (Found in review: refocusing after a successful detection looked like the field
  // had emptied itself and reopened.)
  const skipFocusOpenRef = useRef(false);

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
        const res = await fetch(`/api/planner/places?q=${encodeURIComponent(q)}`).then((r) =>
          r.json(),
        );
        if (!active) return;
        setResults(
          res.ok && Array.isArray(res.data) ? (res.data as PlannerPlace[]).slice(0, 6) : [],
        );
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
    // Return focus to the field (the popup that held it just unmounted) WITHOUT reopening it.
    skipFocusOpenRef.current = true;
    inputRef.current?.focus();
  }

  const showPresets = query.trim().length < 2;

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2.5 rounded-[11px] border border-[#E6EFEE] bg-[#F4F8F7] px-[11px] py-[9px]">
        <span
          className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full ${dotClassName}`}
        >
          <span className="h-[7px] w-[7px] rounded-full bg-white" />
        </span>
        <input
          ref={inputRef}
          // Show the typed query only while there IS one; otherwise always show the current
          // selection, so a programmatic focus can never make a chosen location look erased.
          value={open && query ? query : (value?.name ?? '')}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            // A focus we caused ourselves (after picking) must not reopen the list.
            if (skipFocusOpenRef.current) {
              skipFocusOpenRef.current = false;
              return;
            }
            setOpen(true);
            setQuery('');
          }}
          placeholder={value?.name ?? placeholder}
          aria-label={t('Search a location')}
          className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] font-semibold text-ink outline-none placeholder:font-semibold placeholder:text-ink/70"
        />
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="shrink-0 text-ink-muted"
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Stable, ALWAYS-mounted live region: one that appears at the same moment as its text is
          routinely missed by screen readers (repo pattern — see Checkout.tsx). */}
      <p role="status" aria-live="polite" className="sr-only">
        {locating ? t('Finding your location…') : ''}
      </p>
      {locateError && (
        <p role="alert" className="mt-1.5 text-[12px] font-semibold text-coral-dark">
          {locateError}
        </p>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-64 overflow-y-auto rounded-[12px] border border-[#E6EFEE] bg-white p-1.5 shadow-[0_18px_40px_-18px_rgba(10,46,54,.4)]">
          {/* Outside the showPresets branch on purpose: it must stay reachable once the visitor has
              typed something that found nothing — that's exactly when they need it most. */}
          {onUseMyLocation && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onUseMyLocation}
              disabled={locating}
              aria-busy={locating}
              className="mb-1 flex w-full items-center gap-2 rounded-[9px] border border-[#D8ECEA] bg-teal-tint px-2.5 py-2 text-left text-[13px] font-bold text-teal-dark transition hover:bg-teal/15 focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 disabled:opacity-60"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
                className={`shrink-0 ${locating ? 'animate-spin' : ''}`}
              >
                {locating ? (
                  <path
                    d="M12 3a9 9 0 1 0 9 9"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                  />
                ) : (
                  <>
                    <circle cx="12" cy="12" r="3.2" fill="currentColor" />
                    <path
                      d="M12 2v3m0 14v3M2 12h3m14 0h3"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                    <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth={1.6} />
                  </>
                )}
              </svg>
              {locating ? t('Finding your location…') : t('Use my current location')}
            </button>
          )}
          {showPresets ? (
            <>
              {presets.length > 0 && (
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
                  {t('Popular pick-ups')}
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
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] text-ink-muted">
                {t('Or type a hotel, town or place…')}
              </div>
            </>
          ) : loading ? (
            <div className="px-2.5 py-3 text-[12.5px] text-ink-muted">{t('Searching…')}</div>
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
                  <span className="block truncate text-[13px] font-semibold text-ink">
                    {p.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-muted">
                    {p.region}
                    {p.category ? ` · ${p.category}` : ''}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="px-2.5 py-3 text-[12.5px] text-ink-muted">
              {t('No matches — try a nearby town or hotel name.')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
