import type { AltStop, ItineraryStop } from '@/lib/validation/tours';

/** The place chosen for a stop: 0 = the stop's primary place; 1.. = options[index-1]. */
export function placeForStop(stop: ItineraryStop, sel: number): AltStop {
  if (sel <= 0 || !stop.options || sel > stop.options.length) {
    return { title: stop.title, area: stop.area ?? null, lat: stop.lat, lng: stop.lng };
  }
  const o = stop.options[sel - 1]!;
  return { title: o.title, area: o.area ?? null, lat: o.lat, lng: o.lng };
}

/** The chosen route = the selected place for each stop, in order. */
export function chosenRoute(stops: ItineraryStop[], selectedByStop: Record<number, number>): AltStop[] {
  return stops.map((s, i) => placeForStop(s, selectedByStop[i] ?? 0));
}

/** True when any stop picks an alternative (index > 0) — i.e. a real customisation. */
export function divergesFromDefault(selectedByStop: Record<number, number>): boolean {
  return Object.values(selectedByStop).some((v) => v > 0);
}
