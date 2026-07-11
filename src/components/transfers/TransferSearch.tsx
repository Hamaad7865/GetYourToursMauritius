'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { transfers, nearestTransfer, type Transfer } from '@/lib/content/transfers';
import { useGoogleMaps } from '@/lib/maps/useGoogleMaps';
import { IconArrowRight, IconPin, IconSearch } from '@/components/ui/icons';

/**
 * Airport-transfer search bar: the origin is FIXED to SSR International Airport (every transfer starts or
 * ends there); the traveller searches their hotel and is taken to that hotel's bookable page. When Google
 * Maps is ready the "To" field is a live Google Places autocomplete over ANY hotel/resort in Mauritius —
 * a picked place that isn't one of our 45 listed hotels is SNAPPED to the geographically nearest listed
 * hotel (same coarse airport zone → same fixed price → a real bookable page). When Maps isn't ready it
 * degrades to the curated typeahead over our covered resorts.
 */
export function TransferSearch() {
  const router = useRouter();
  const placesReady = useGoogleMaps() === 'ready';
  const go = (t: Transfer) => router.push(t.path);

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-4 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.45)] sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] sm:items-end">
        {/* From — fixed to the airport */}
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">From</div>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-ink/10 bg-cream/40 px-3.5 py-2.5 text-sm font-semibold text-ink">
            <IconPin width={16} height={16} className="shrink-0 text-coral" />
            SSR International Airport
          </div>
        </div>

        <div className="hidden place-items-center pb-2.5 text-ink/40 sm:grid">
          <IconArrowRight width={18} height={18} />
        </div>

        {/* To — Google Places (any hotel) when Maps is ready, else the curated typeahead. */}
        {placesReady ? <PlacesToField onPick={go} /> : <TypeaheadToField onPick={go} />}
      </div>
    </div>
  );
}

/** Live Google Places autocomplete (any place in Mauritius). A picked place is snapped to the nearest
 *  listed hotel by coordinates so its zone/price/page carry through. Uncontrolled input — Google manages
 *  its value + its own suggestion dropdown. */
function PlacesToField({ onPick }: { onPick: (t: Transfer) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    let ac: google.maps.places.Autocomplete | null = null;
    try {
      ac = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'mu' },
        fields: ['name', 'geometry'],
      });
      ac.addListener('place_changed', () => {
        const loc = ac!.getPlace().geometry?.location;
        if (!loc) return;
        onPickRef.current(nearestTransfer(loc.lat(), loc.lng()));
      });
    } catch {
      /* Places unavailable — the typeahead branch covers it */
    }
    return () => {
      if (ac) google.maps.event.clearInstanceListeners(ac);
      // Google appends a .pac-container to <body> per Autocomplete and never removes it — every
      // client-side revisit stacked another. Only these widgets create them, so sweep them all.
      document.querySelectorAll('.pac-container').forEach((el) => el.remove());
    };
  }, []);

  return (
    <div className="relative">
      <label className="text-[12px] font-bold uppercase tracking-wide text-ink-muted" htmlFor="transfer-hotel-search">
        To — your hotel
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-ink/15 bg-cream/40 px-3.5 py-2.5 focus-within:border-teal">
        <IconSearch width={16} height={16} className="shrink-0 text-ink-muted" />
        <input
          id="transfer-hotel-search"
          ref={inputRef}
          autoComplete="off"
          placeholder="Search your hotel or resort…"
          className="w-full bg-transparent text-sm font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-muted"
        />
      </div>
    </div>
  );
}

/** Fallback: typeahead over the 45 covered resorts (used until Google Maps is ready / if it fails). */
function TypeaheadToField({ onPick }: { onPick: (t: Transfer) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo<Transfer[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return transfers
      .filter((t) => t.hotelName.toLowerCase().includes(s) || t.area.toLowerCase().includes(s))
      .slice(0, 8);
  }, [q]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const t = matches[active] ?? matches[0];
      if (t) onPick(t);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label className="text-[12px] font-bold uppercase tracking-wide text-ink-muted" htmlFor="transfer-hotel-search">
        To — your hotel
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-ink/15 bg-cream/40 px-3.5 py-2.5 focus-within:border-teal">
        <IconSearch width={16} height={16} className="shrink-0 text-ink-muted" />
        <input
          id="transfer-hotel-search"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls="transfer-hotel-list"
          aria-activedescendant={open && matches.length > 0 ? `transfer-opt-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          value={q}
          placeholder="Search your hotel or resort…"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent text-sm font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-muted"
        />
      </div>

      {open && q.trim() !== '' && (
        <ul
          id="transfer-hotel-list"
          role="listbox"
          className="absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-ink/10 bg-white py-1 shadow-xl"
        >
          {matches.length === 0 ? (
            <li className="px-4 py-3 text-[13px] text-ink-muted">
              No match in our list.{' '}
              <Link
                href="/contact"
                className="font-bold text-teal hover:text-teal-dark"
                onMouseDown={(e) => e.preventDefault()}
              >
                Message us for a quote
              </Link>
              .
            </li>
          ) : (
            matches.map((t, i) => (
              <li key={t.slug} id={`transfer-opt-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // onMouseDown (not onClick) so the navigation fires before the input's onBlur closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    onPick(t);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                    i === active ? 'bg-teal/10' : 'hover:bg-ink/[0.03]'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-ink">{t.hotelName}</span>
                    <span className="block text-[12px] text-ink-muted">
                      {t.area} · {t.region} coast
                    </span>
                  </span>
                  <span className="shrink-0 text-[12.5px] font-extrabold text-ink">from €{t.fromPriceEur}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
