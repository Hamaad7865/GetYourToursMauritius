'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import { addStop, moveStop, removeStop, toStops, withIds, type BuilderStop } from '@/lib/itinerary/route';
import { RouteMap } from '@/components/maps/RouteMap';
import { PickupMap } from '@/components/maps/PickupMap';
import { mapsDirectionsUrl } from '@/lib/maps/urls';
import { IconChevron, IconMinus, IconPlus } from '@/components/ui/icons';

/**
 * Customer route builder: start from the default itinerary (all removable), add admin-curated optional
 * stops, reorder with up/down, set a pickup as the route origin (preview-only). The chosen stops are
 * stashed in sessionStorage (`gytm:itinerary:<slug>`) for checkout to save on the booking; the map
 * draws the live driving route with an animated car.
 */
export function ItineraryBuilder({
  slug,
  defaultStops,
  optionalStops,
  maxStops = 8,
}: {
  slug: string;
  defaultStops: ItineraryStop[];
  optionalStops: ItineraryStop[];
  maxStops?: number;
}) {
  const initial = useMemo(() => withIds(defaultStops, 'def'), [defaultStops]);
  const pool = useMemo(() => withIds(optionalStops, 'opt'), [optionalStops]);
  const [selected, setSelected] = useState<BuilderStop[]>(initial);
  const [pickup, setPickup] = useState('');
  const [pickAdd, setPickAdd] = useState(false);

  const available = pool.filter((p) => !selected.some((s) => s.id === p.id));

  // Stash the chosen stops for checkout — ONLY when the route actually diverges from the default, so
  // an untouched tour saves no customItinerary (null = standard route) and nothing stale is left for
  // an unrelated booking. Slug-keyed; cleared when back to the default or empty.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `gytm:itinerary:${slug}`;
    const route = toStops(selected);
    const isDefault = JSON.stringify(route) === JSON.stringify(defaultStops);
    if (route.length && !isDefault) window.sessionStorage.setItem(key, JSON.stringify(route));
    else window.sessionStorage.removeItem(key);
  }, [slug, selected, defaultStops]);

  // The map route: pickup (if entered) as place 1, then the chosen stops.
  const mapStops: ItineraryStop[] = useMemo(
    () => [...(pickup.trim() ? [{ title: pickup.trim() } as ItineraryStop] : []), ...toStops(selected)],
    [pickup, selected],
  );
  // Debounce so the map + Directions don't redraw on every pickup keystroke.
  const [mapStopsDebounced, setMapStopsDebounced] = useState(mapStops);
  useEffect(() => {
    const t = setTimeout(() => setMapStopsDebounced(mapStops), 500);
    return () => clearTimeout(t);
  }, [mapStops]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div>
        {/* Pickup origin (preview-only) */}
        <div className="mb-4 rounded-xl border border-ink/10 p-3">
          <div className="text-[13px] font-bold text-ink">Your pickup (start of the route)</div>
          <PickupMap value={pickup} onChange={setPickup} placeholder="Hotel, Airbnb or cruise port" />
        </div>

        <ol className="relative m-0 list-none p-0">
          {selected.map((stop, i) => (
            <li key={stop.id} className="relative flex items-start gap-3 pb-4">
              <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal/10 text-[12px] font-bold text-teal">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold text-ink">{stop.title}</div>
                {stop.area && <div className="text-[13px] text-ink-muted">{stop.area}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move ${stop.title} up`}
                  disabled={i === 0}
                  onClick={() => setSelected((s) => moveStop(s, stop.id, -1))}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-ink/15 text-ink hover:border-teal disabled:opacity-30"
                >
                  <IconChevron width={14} height={14} className="rotate-180" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${stop.title} down`}
                  disabled={i === selected.length - 1}
                  onClick={() => setSelected((s) => moveStop(s, stop.id, 1))}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-ink/15 text-ink hover:border-teal disabled:opacity-30"
                >
                  <IconChevron width={14} height={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${stop.title}`}
                  onClick={() => setSelected((s) => removeStop(s, stop.id))}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-ink/15 text-ink-muted hover:border-coral hover:text-coral"
                >
                  <IconMinus width={14} height={14} />
                </button>
              </div>
            </li>
          ))}
        </ol>

        {/* Add a stop */}
        {available.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickAdd((o) => !o)}
              disabled={selected.length >= maxStops}
              className="flex items-center gap-2 rounded-full border border-teal/40 px-4 py-2 text-sm font-bold text-teal hover:bg-teal/5 disabled:opacity-40"
            >
              <IconPlus width={15} height={15} /> Add a place
            </button>
            {selected.length >= maxStops && (
              <p className="mt-1.5 text-[12px] text-ink-muted">
                You&apos;ve reached the maximum of {maxStops} stops.
              </p>
            )}
            {pickAdd && selected.length < maxStops && (
              <div className="absolute z-20 mt-2 w-full max-w-sm rounded-xl border border-ink/12 bg-white p-1.5 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
                {available.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelected((s) => addStop(s, p, maxStops));
                      setPickAdd(false);
                    }}
                    className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-cream"
                  >
                    <span className="text-sm font-semibold text-ink">{p.title}</span>
                    {p.area && <span className="text-[12px] text-ink-muted">{p.area}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="mt-3 text-[12px] text-ink-muted">
          Build your route at no extra cost — your driver follows the order above.
        </p>
      </div>

      <div>
        <RouteMap stops={mapStopsDebounced} animate />
        <a
          href={mapsDirectionsUrl(mapStopsDebounced.map((s) => s.title))}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm font-bold text-teal underline underline-offset-2 hover:text-teal-dark"
        >
          Open in Google Maps
        </a>
      </div>
    </div>
  );
}
