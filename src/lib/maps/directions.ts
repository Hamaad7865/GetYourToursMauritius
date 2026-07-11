import { ProviderError } from '@/lib/services/errors';
import type { LatLng, RouteLeg } from './haversine';

/**
 * Server-side Google Routes API (Directions v2) client — real driving distance/time for the planner.
 * Edge-compatible (native fetch). Returns ONE leg per consecutive pair of points (origin → each
 * intermediate → destination). Throws ProviderError on any failure so planRoute can fall back to the
 * haversine estimate. This is Google's current Directions/routing API.
 */
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

interface RoutesLeg {
  distanceMeters?: number;
  duration?: string; // e.g. "754s"
}
interface RoutesResponse {
  routes?: Array<{ legs?: RoutesLeg[] }>;
}

export async function getRouteLegsViaRoutes(points: LatLng[], apiKey: string): Promise<RouteLeg[]> {
  if (points.length < 2) return [];
  const wp = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.legs.distanceMeters,routes.legs.duration',
    },
    body: JSON.stringify({
      origin: wp(points[0]!),
      destination: wp(points[points.length - 1]!),
      intermediates: points.slice(1, -1).map(wp),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    }),
  });
  if (!res.ok) throw new ProviderError(`Routes computeRoutes HTTP ${res.status}`);
  const data = (await res.json()) as RoutesResponse;
  const legs = data.routes?.[0]?.legs;
  if (!legs || legs.length !== points.length - 1) {
    throw new ProviderError(`Routes legs mismatch (${legs?.length ?? 0} vs ${points.length - 1})`);
  }
  return legs.map((l) => {
    const meters = l.distanceMeters ?? 0;
    const secs = parseInt(String(l.duration ?? '0').replace('s', ''), 10) || 0;
    return {
      km: Math.max(1, Math.round(meters / 1000)),
      minutes: Math.max(1, Math.round(secs / 60)),
    };
  });
}
