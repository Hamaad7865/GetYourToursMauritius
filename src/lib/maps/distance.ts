import { ProviderError } from '@/lib/services/errors';
import type { LatLng, RouteLeg } from './haversine';

/**
 * Server-side Google Distance Matrix client — real driving distance/time for the road-trip planner.
 * Edge-compatible (native fetch). Returns ONE leg per consecutive pair of points (the matrix
 * diagonal of origins[0..n-1] × destinations[1..n]). Throws ProviderError on any failure so the
 * caller (planRoute) can fall back to the haversine estimate.
 */
const ENDPOINT = 'https://maps.googleapis.com/maps/api/distancematrix/json';

interface DmElement {
  status: string;
  distance?: { value: number };
  duration?: { value: number };
}
interface DmResponse {
  status: string;
  rows?: Array<{ elements?: DmElement[] }>;
}

export async function getRouteLegs(points: LatLng[], apiKey: string): Promise<RouteLeg[]> {
  if (points.length < 2) return [];
  const fmt = (p: LatLng): string => `${p.lat},${p.lng}`;
  const origins = points.slice(0, -1).map(fmt).join('|');
  const destinations = points.slice(1).map(fmt).join('|');
  const url =
    `${ENDPOINT}?origins=${encodeURIComponent(origins)}` +
    `&destinations=${encodeURIComponent(destinations)}&mode=driving&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);
  if (!res.ok) throw new ProviderError(`Distance Matrix HTTP ${res.status}`);
  const data = (await res.json()) as DmResponse;
  if (data.status !== 'OK') throw new ProviderError(`Distance Matrix status ${data.status}`);

  const legs: RouteLeg[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const el = data.rows?.[i]?.elements?.[i]; // consecutive leg i -> i+1 is on the diagonal
    if (!el || el.status !== 'OK' || !el.distance || !el.duration) {
      throw new ProviderError(`Distance Matrix element ${i}: ${el?.status ?? 'missing'}`);
    }
    legs.push({ km: Math.round(el.distance.value / 1000), minutes: Math.round(el.duration.value / 60) });
  }
  return legs;
}
