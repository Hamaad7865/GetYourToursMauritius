import { getRouteLegsViaRoutes } from './directions';
import { getRouteLegs } from './distance';
import { haversineLegs, type LatLng, type RouteLeg } from './haversine';

/**
 * Plan a route through `points`. With an apiKey it uses Google's Routes API (Directions v2) for real
 * drive times, falling back to the legacy Distance Matrix API, then to the haversine estimate when
 * there's no key or both calls fail. `estimate` flags whether the numbers are the fallback.
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
      // Routes API (Directions v2) first — Google's current routing API.
      return finalize(await getRouteLegsViaRoutes(points, apiKey), false);
    } catch {
      try {
        // Legacy Distance Matrix fallback (in case only that API is enabled on the key).
        return finalize(await getRouteLegs(points, apiKey), false);
      } catch {
        // Neither routing API available (not enabled, billing, quota, network) — degrade, never break.
        return finalize(haversineLegs(points), true);
      }
    }
  }
  return finalize(haversineLegs(points), true);
}
