'use client';

import { RouteMap } from '@/components/maps/RouteMap';
import type { ItineraryStop } from '@/lib/validation/tours';

/** SSR International Airport (the fixed origin for every transfer). */
export const SSR_AIRPORT = { title: 'SSR International Airport', lat: -20.43, lng: 57.68 } as const;

/**
 * The real driving route from SSR Airport to a hotel, shown on the hotel page. Reuses the shared
 * RouteMap (Routes API + animated car); the hotel is geocoded by name when its coords aren't known.
 */
export function TransferRouteMap({
  hotelName,
  lat,
  lng,
}: {
  hotelName: string;
  lat?: number | null;
  lng?: number | null;
}) {
  const stops: ItineraryStop[] = [
    { title: SSR_AIRPORT.title, lat: SSR_AIRPORT.lat, lng: SSR_AIRPORT.lng },
    { title: hotelName, lat: lat ?? undefined, lng: lng ?? undefined },
  ];
  return (
    <RouteMap
      stops={stops}
      kinds={['start', 'main']}
      labels={['A', 'B']}
      animate
      className="h-[260px] w-full overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.04] lg:h-[300px]"
    />
  );
}
