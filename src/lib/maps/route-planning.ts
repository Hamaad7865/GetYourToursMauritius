import { getRouteLegs } from './distance';
import { haversineLegs, type LatLng, type RouteLeg } from './haversine';

/**
 * Plan a closed route through `points` (pickup -> stops -> pickup is the caller's responsibility to
 * order). Uses Google Distance Matrix when an apiKey is given, falling back to the haversine estimate
 * when there's no key or the API call fails. `estimate` flags whether the numbers are the fallback.
 */
export interface PlannedRoute {
  legs: RouteLeg[];
  totalKm: number;
  totalMinutes: number;
  estimate: boolean;
}

function finalize(legs: RouteLeg[], estimate: boolean): PlannedRoute {
  return {
    legs,
    totalKm: Math.round(legs.reduce((s, l) => s + l.km, 0)),
    totalMinutes: legs.reduce((s, l) => s + l.minutes, 0),
    estimate,
  };
}

export async function planRoute(points: LatLng[], apiKey?: string | null): Promise<PlannedRoute> {
  if (points.length < 2) return finalize([], false);
  if (apiKey) {
    try {
      return finalize(await getRouteLegs(points, apiKey), false);
    } catch {
      // Distance Matrix unavailable (no billing, quota, network) — degrade, never break.
      return finalize(haversineLegs(points), true);
    }
  }
  return finalize(haversineLegs(points), true);
}
