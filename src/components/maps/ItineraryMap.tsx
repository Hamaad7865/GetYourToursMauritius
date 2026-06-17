'use client';

import type { ItineraryStop } from '@/lib/validation/tours';
import { RouteMap, type StopKind } from './RouteMap';

/** Whether any stop on the map is a swappable "other" stop — drives showing that legend entry. */
function hasOther(kinds: StopKind[] | undefined): boolean {
  return (kinds ?? []).includes('other');
}

/**
 * The itinerary route map plus its marker legend, shared by the read-only and the customisable
 * (alternatives) itineraries so they look identical. Pickup/start is a coral pin; fixed stops are
 * solid teal "main" pins; swappable stops are hollow teal "other" pins.
 */
export function ItineraryMap({ stops, kinds }: { stops: ItineraryStop[]; kinds?: StopKind[] }) {
  return (
    <div>
      <RouteMap stops={stops} kinds={kinds} />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-teal" /> Main stop
        </span>
        {hasOther(kinds) && (
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full border-2 border-teal bg-white" /> Other stop
          </span>
        )}
      </div>
    </div>
  );
}
