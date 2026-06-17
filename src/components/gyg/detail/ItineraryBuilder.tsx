'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import { chosenRoute, divergesFromDefault, placeForStop } from '@/lib/itinerary/route';
import { RouteMap } from '@/components/maps/RouteMap';
import { PickupMap } from '@/components/maps/PickupMap';
import { mapsDirectionsUrl } from '@/lib/maps/urls';

/**
 * Per-stop route chooser: a fixed timeline of the tour's stops. Any stop that has alternatives shows
 * the primary + alternatives as selectable chips; the customer picks ONE per stop (no add/remove/
 * reorder). The chosen route is stashed in sessionStorage (`gytm:itinerary:<slug>`) for checkout —
 * only when it diverges from all-primaries — and the map draws the live driving route with a car.
 */
export function ItineraryBuilder({ slug, stops }: { slug: string; stops: ItineraryStop[] }) {
  // selectedByStop[i] = 0 (primary) | 1.. (options[n-1]).
  const [selectedByStop, setSelectedByStop] = useState<Record<number, number>>({});
  const [pickup, setPickup] = useState('');

  const route = useMemo(() => chosenRoute(stops, selectedByStop), [stops, selectedByStop]);

  // Stash only when the customer actually swapped something (else null = standard route).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `gytm:itinerary:${slug}`;
    if (divergesFromDefault(selectedByStop)) {
      window.sessionStorage.setItem(key, JSON.stringify(route));
    } else {
      window.sessionStorage.removeItem(key);
    }
  }, [slug, selectedByStop, route]);

  const mapStops: ItineraryStop[] = useMemo(
    () => [...(pickup.trim() ? [{ title: pickup.trim() } as ItineraryStop] : []), ...route],
    [pickup, route],
  );
  const [mapStopsDebounced, setMapStopsDebounced] = useState(mapStops);
  useEffect(() => {
    const t = setTimeout(() => setMapStopsDebounced(mapStops), 500);
    return () => clearTimeout(t);
  }, [mapStops]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <div className="mb-4 rounded-xl border border-ink/10 p-3">
          <div className="text-[13px] font-bold text-ink">Your pickup (start of the route)</div>
          <PickupMap value={pickup} onChange={setPickup} placeholder="Hotel, Airbnb or cruise port" />
        </div>

        <ol className="relative m-0 list-none p-0">
          {stops.map((stop, i) => {
            const sel = selectedByStop[i] ?? 0;
            const hasOptions = (stop.options?.length ?? 0) > 0;
            const chosen = placeForStop(stop, sel);
            const choices = [
              { title: stop.title, area: stop.area ?? null },
              ...(stop.options ?? []).map((o) => ({ title: o.title, area: o.area ?? null })),
            ];
            return (
              <li key={i} className="relative flex items-start gap-3 pb-4">
                <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal/10 text-[12px] font-bold text-teal">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold text-ink">{chosen.title}</div>
                  {chosen.area && <div className="text-[13px] text-ink-muted">{chosen.area}</div>}
                  {hasOptions && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {choices.map((c, ci) => {
                        const active = sel === ci;
                        return (
                          <button
                            key={ci}
                            type="button"
                            onClick={() => setSelectedByStop((m) => ({ ...m, [i]: ci }))}
                            className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${
                              active
                                ? 'border-teal bg-teal/5 text-teal-dark'
                                : 'border-ink/15 text-ink-muted hover:border-teal'
                            }`}
                          >
                            {c.title}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-3 text-[12px] text-ink-muted">
          Pick the places you want at each stop — no extra cost. Your driver follows your choices.
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
