import type { ItineraryStop } from '@/lib/validation/tours';

/** An itinerary stop carrying a stable client id (for React keys + add/remove/move). */
export type BuilderStop = ItineraryStop & { id: string };

/** Assign stable ids to a list of stops (`def-0`, `opt-1`, …). */
export function withIds(stops: ItineraryStop[], prefix: string): BuilderStop[] {
  return stops.map((s, i) => ({ ...s, id: `${prefix}-${i}` }));
}

/** Append `stop` if it isn't already selected and the route is under `max`. Pure. */
export function addStop(selected: BuilderStop[], stop: BuilderStop, max: number): BuilderStop[] {
  if (selected.some((s) => s.id === stop.id)) return selected;
  if (selected.length >= max) return selected;
  return [...selected, stop];
}

/** Remove the stop with `id`. */
export function removeStop(selected: BuilderStop[], id: string): BuilderStop[] {
  return selected.filter((s) => s.id !== id);
}

/** Move the stop with `id` one position in `dir` (-1 up, 1 down); no-op at the ends. */
export function moveStop(selected: BuilderStop[], id: string, dir: -1 | 1): BuilderStop[] {
  const i = selected.findIndex((s) => s.id === id);
  if (i < 0) return selected;
  const j = i + dir;
  if (j < 0 || j >= selected.length) return selected;
  const next = [...selected];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Strip client ids for persistence (what gets saved on the booking + sent to the map). */
export function toStops(selected: BuilderStop[]): ItineraryStop[] {
  return selected.map(({ id: _id, ...stop }) => stop);
}
