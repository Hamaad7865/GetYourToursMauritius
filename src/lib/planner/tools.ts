import { searchGooglePlaces, placeDetailsByIds, type PlacesSearchArgs } from '@/lib/maps/google-places';
import { planRoute, type PlannedRoute } from '@/lib/maps/route-planning';
import { placeCountWarning } from '@/lib/planner/pricing';
import type { PlannerPlace } from '@/lib/validation/planner';

/**
 * The grounded operations the AI co-pilot performs — now over LIVE Google Places (not a seed). The
 * Gemini agent wraps these as tool calls; keeping the logic here means facts (places, routes) come
 * from Google, never the model. Places discovered during search are cached by the caller so committing
 * an itinerary doesn't re-fetch (and avoids extra Place Details billing).
 */
export type SearchPlacesArgs = PlacesSearchArgs;

/** Search live Google Places (Mauritius) by free text, category and/or region. */
export async function searchPlannerPlaces(args: SearchPlacesArgs, apiKey: string | null): Promise<PlannerPlace[]> {
  if (!apiKey) return [];
  return searchGooglePlaces(args, apiKey);
}

export interface ResolvedItinerary {
  /** The known places, in the requested order. */
  places: PlannerPlace[];
  /** Ids the model asked for that couldn't be resolved (so it can self-correct). */
  unknownIds: string[];
  /** Real (or estimated) drive-time route through the places. */
  route: PlannedRoute;
  /** Soft "too many stops" warning, or null. */
  warning: string | null;
}

/**
 * Resolve place ids into an ordered itinerary with a drive-time route + place-count warning. Resolves
 * from the `discovered` cache first (places already returned by search_places this turn), then Place
 * Details for anything missing. Unknown ids are reported, not silently dropped.
 */
export async function resolveItinerary(
  placeIds: string[],
  discovered: Map<string, PlannerPlace>,
  apiKey: string | null,
): Promise<ResolvedItinerary> {
  const missing = placeIds.filter((id) => !discovered.has(id));
  if (missing.length && apiKey) {
    for (const p of await placeDetailsByIds(missing, apiKey)) discovered.set(p.id, p);
  }
  const places: PlannerPlace[] = [];
  const unknownIds: string[] = [];
  for (const id of placeIds) {
    const place = discovered.get(id);
    if (place) places.push(place);
    else unknownIds.push(id);
  }
  const route = await planRoute(
    places.map((p) => ({ lat: p.lat, lng: p.lng })),
    apiKey,
  );
  return { places, unknownIds, route, warning: placeCountWarning(places.length) };
}
