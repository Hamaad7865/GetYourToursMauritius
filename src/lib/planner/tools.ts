import {
  searchGooglePlaces,
  placeDetailsByIds,
  type PlacesSearchArgs,
} from '@/lib/maps/google-places';
import { planRoute, type PlannedRoute } from '@/lib/maps/route-planning';
import { filterItinerary } from '@/lib/planner/constraints';
import type { PlannerPlace } from '@/lib/validation/planner';

/**
 * The grounded operations the AI co-pilot performs — now over LIVE Google Places (not a seed). The
 * Gemini agent wraps these as tool calls; keeping the logic here means facts (places, routes) come
 * from Google, never the model. Places discovered during search are cached by the caller so committing
 * an itinerary doesn't re-fetch (and avoids extra Place Details billing).
 */
export type SearchPlacesArgs = PlacesSearchArgs;

/** Search live Google Places (Mauritius) by free text, category and/or region. */
export async function searchPlannerPlaces(
  args: SearchPlacesArgs,
  apiKey: string | null,
): Promise<PlannerPlace[]> {
  if (!apiKey) return [];
  return searchGooglePlaces(args, apiKey);
}

export interface ResolvedItinerary {
  /** The committed places (region-coherent, capped), in the requested order. */
  places: PlannerPlace[];
  /** Ids the model asked for that couldn't be resolved (so it can self-correct). */
  unknownIds: string[];
  /** Places dropped because their region is `far` from the rest of the day. */
  rejectedFarRegion: PlannerPlace[];
  /** Places dropped because the day was already at the {@link MAX_STOPS} cap. */
  droppedOverCap: PlannerPlace[];
  /** Real (or estimated) drive-time route through the committed places. */
  route: PlannedRoute;
}

/**
 * Resolve place ids into an ordered, region-coherent, capped itinerary with a drive-time route.
 * Resolves from the `discovered` cache first (places already returned by search_places this turn),
 * then Place Details for anything missing. Unknown ids are reported, not silently dropped. The
 * resolved places are then filtered against the day's guardrails (region coherence + 6-stop cap)
 * using the existing day as the compatibility basis, so a far-region request can't wipe the day.
 */
export async function resolveItinerary(
  placeIds: string[],
  discovered: Map<string, PlannerPlace>,
  apiKey: string | null,
  existing: PlannerPlace[] = [],
): Promise<ResolvedItinerary> {
  const missing = placeIds.filter((id) => !discovered.has(id));
  if (missing.length && apiKey) {
    for (const p of await placeDetailsByIds(missing, apiKey)) discovered.set(p.id, p);
  }
  const resolved: PlannerPlace[] = [];
  const unknownIds: string[] = [];
  for (const id of placeIds) {
    const place = discovered.get(id);
    if (place) resolved.push(place);
    else unknownIds.push(id);
  }
  const { accepted, rejectedFarRegion, droppedOverCap } = filterItinerary(resolved, existing);
  const route = await planRoute(
    accepted.map((p) => ({ lat: p.lat, lng: p.lng })),
    apiKey,
  );
  return { places: accepted, unknownIds, rejectedFarRegion, droppedOverCap, route };
}
