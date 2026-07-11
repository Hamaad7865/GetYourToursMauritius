import type { PlannerPlace } from '@/lib/validation/planner';

/** The fields of a tour itinerary stop the resolver needs — just the human-readable name. */
export interface TourStopLite {
  title: string;
  area?: string | null;
}

/**
 * Resolve a tour's itinerary stops into real {@link PlannerPlace} objects so the AI Road Trip Planner
 * can preload the day. Tour stops carry only a title (no coords or place id), so each is looked up via
 * the injected `searchOne` (a Google Text Search, in practice). Pure + injectable so the resolution
 * rules — preserve order, skip stops that don't resolve, drop duplicates — are unit-testable without
 * touching Google. Lookups run in parallel; a single failed lookup just drops that one stop.
 */
export async function resolveTourStops(
  stops: TourStopLite[],
  searchOne: (query: string) => Promise<PlannerPlace | null>,
): Promise<PlannerPlace[]> {
  const resolved = await Promise.all(stops.map((s) => searchOne(s.title.trim()).catch(() => null)));
  const seen = new Set<string>();
  const out: PlannerPlace[] = [];
  for (const place of resolved) {
    if (place && !seen.has(place.id)) {
      seen.add(place.id);
      out.push(place);
    }
  }
  return out;
}
