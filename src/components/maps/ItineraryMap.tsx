'use client';

import type { ItineraryStop } from '@/lib/validation/tours';
import { RouteMap, type StopKind } from './RouteMap';

/** Whether any stop on the map is a swappable "other" stop — drives showing that legend entry. */
function hasOther(kinds: StopKind[] | undefined): boolean {
  return (kinds ?? []).includes('other');
}

/** Mini teardrop pin for the legend — the same shapes the map markers use, at caption size. */
function LegendPin({ kind }: { kind: StopKind }) {
  const color = kind === 'start' ? '#F76C5E' : '#0E8C92';
  if (kind === 'other') {
    return (
      <svg width="12" height="15" viewBox="0 0 30 38" aria-hidden>
        <path
          d="M15 1.2C7.4 1.2 1.2 7.4 1.2 15c0 9.4 13.8 22 13.8 22s13.8-12.6 13.8-22C28.8 7.4 22.6 1.2 15 1.2z"
          fill="#fff"
          stroke={color}
          strokeWidth="3"
        />
        <circle cx="15" cy="15" r="5.5" fill={color} />
      </svg>
    );
  }
  return (
    <svg width="12" height="15" viewBox="0 0 30 38" aria-hidden>
      <path d="M15 0C6.7 0 0 6.7 0 15c0 9.7 15 23 15 23s15-13.3 15-23C30 6.7 23.3 0 15 0z" fill={color} />
      <circle cx="15" cy="15" r="6" fill="#fff" />
    </svg>
  );
}

/**
 * The itinerary route map plus its marker legend, shared by the read-only and the customisable
 * (alternatives) itineraries so they look identical. Pickup/start is a coral pin; fixed stops are
 * solid teal "main" pins; swappable stops are hollow teal "other" pins.
 */
export function ItineraryMap({ stops, kinds }: { stops: ItineraryStop[]; kinds?: StopKind[] }) {
  const hasStart = (kinds ?? []).includes('start');
  return (
    <div>
      <RouteMap stops={stops} kinds={kinds} animate />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        {hasStart && (
          <span className="flex items-center gap-1.5">
            <LegendPin kind="start" /> Pickup
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <LegendPin kind="main" /> Main stop
        </span>
        {hasOther(kinds) && (
          <span className="flex items-center gap-1.5">
            <LegendPin kind="other" /> Other stop
          </span>
        )}
      </div>
    </div>
  );
}
