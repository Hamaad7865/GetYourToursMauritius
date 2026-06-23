'use client';

import { useEffect, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import { useGoogleMaps } from '@/lib/maps/useGoogleMaps';
import { geocode } from '@/lib/maps/geocode';
import { nearestNeighborOrder, type MaybePoint } from '@/lib/itinerary/order';
import { ItineraryTimeline, type TimelineNode } from './ItineraryTimeline';
import { ItineraryMap } from '@/components/maps/ItineraryMap';
import type { StopKind } from '@/components/maps/RouteMap';

/**
 * Itinerary timeline + route map, auto-ordered into an efficient visiting sequence so the drawn route
 * never zig-zags (e.g. a centre-island stop typed in the middle of a southbound run no longer makes the
 * route backtrack). `nodes`, `stops` and `kinds` are index-aligned (a pickup, when present, is index 0 in
 * all three). We geocode the stops once — reusing the cached Maps geocoder the map would use anyway — then
 * compute a nearest-neighbour order anchored at the first stop and render BOTH the numbered list and the
 * map in that single order, so the pins, the list and the route always agree. The resolved coordinates are
 * merged onto the stops handed to the map, so it doesn't geocode a second time.
 *
 * Until Maps is ready / geocoding resolves we render the original order (then settle once), so there's no
 * hard dependency on Maps and no SSR/hydration mismatch.
 */
export function RoutedItinerary({
  nodes,
  stops,
  kinds,
  collapseAt,
}: {
  nodes: TimelineNode[];
  stops: ItineraryStop[];
  kinds?: StopKind[];
  collapseAt?: number;
}) {
  const status = useGoogleMaps();
  const [order, setOrder] = useState<number[] | null>(null);
  const [coords, setCoords] = useState<Record<number, google.maps.LatLngLiteral>>({});

  useEffect(() => {
    if (status !== 'ready' || stops.length < 3) return;
    let cancelled = false;
    void (async () => {
      const points: MaybePoint[] = await Promise.all(
        stops.map((s) =>
          typeof s.lat === 'number' && typeof s.lng === 'number'
            ? Promise.resolve<MaybePoint>({ lat: s.lat, lng: s.lng })
            : geocode(s.title),
        ),
      );
      if (cancelled) return;
      const resolved: Record<number, google.maps.LatLngLiteral> = {};
      points.forEach((p, i) => {
        if (p) resolved[i] = p;
      });
      setCoords(resolved);
      setOrder(nearestNeighborOrder(points));
    })();
    return () => {
      cancelled = true;
    };
  }, [status, stops]);

  const ord = order ?? stops.map((_, i) => i);
  const orderedNodes = ord.map((i) => nodes[i]!);
  // Merge the geocoded coords onto each stop so the map reuses them (no second geocode pass).
  const orderedStops = ord.map((i) => ({ ...stops[i]!, ...(coords[i] ?? {}) }));
  const orderedKinds = kinds ? ord.map((i) => kinds[i]!) : undefined;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
      <ItineraryTimeline nodes={orderedNodes} collapseAt={collapseAt} />
      <ItineraryMap stops={orderedStops} kinds={orderedKinds} />
    </div>
  );
}
