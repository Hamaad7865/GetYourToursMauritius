import type { ServiceContext } from '@/lib/services/context';
import { listPlannerPlaces } from '@/lib/services/planner';
import { planRoute, type PlannedRoute } from '@/lib/maps/route-planning';
import { placeCountWarning } from '@/lib/planner/pricing';
import type { PlannerPlace } from '@/lib/validation/planner';

/**
 * The grounded operations the AI co-pilot performs. Pure-ish domain logic over the curated places +
 * the drive-time layer — deterministic and unit-tested. The Gemini agent (planner-agent) wraps these
 * as tool calls; keeping the logic here means facts (places, routes) come from the DB/Google, never
 * the model.
 */
export interface SearchPlacesArgs {
  query?: string;
  category?: string;
  region?: string;
}

/** Search the curated places by free text, category and/or region. */
export async function searchPlannerPlaces(ctx: ServiceContext, args: SearchPlacesArgs): Promise<PlannerPlace[]> {
  const all = await listPlannerPlaces(ctx);
  const q = args.query?.trim().toLowerCase();
  return all.filter((p) => {
    if (args.region && p.region !== args.region) return false;
    if (args.category && p.category !== args.category) return false;
    if (q) {
      const hay = `${p.name} ${p.blurb ?? ''} ${p.category} ${p.region}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface ResolvedItinerary {
  /** The known places, in the requested order. */
  places: PlannerPlace[];
  /** Ids the model asked for that aren't in the curated set (so it can correct itself). */
  unknownIds: string[];
  /** Real (or estimated) drive-time route through the places. */
  route: PlannedRoute;
  /** Soft "too many stops" warning, or null. */
  warning: string | null;
}

/**
 * Resolve a list of place ids into an ordered itinerary with a drive-time route + place-count
 * warning. Unknown ids are reported (not silently dropped) so the agent can self-correct.
 */
export async function resolveItinerary(
  ctx: ServiceContext,
  placeIds: string[],
  apiKey?: string | null,
): Promise<ResolvedItinerary> {
  const byId = new Map((await listPlannerPlaces(ctx)).map((p) => [p.id, p]));
  const places: PlannerPlace[] = [];
  const unknownIds: string[] = [];
  for (const id of placeIds) {
    const place = byId.get(id);
    if (place) places.push(place);
    else unknownIds.push(id);
  }
  const route = await planRoute(
    places.map((p) => ({ lat: p.lat, lng: p.lng })),
    apiKey,
  );
  return { places, unknownIds, route, warning: placeCountWarning(places.length) };
}
