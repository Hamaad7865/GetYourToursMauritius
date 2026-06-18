/**
 * Great-circle drive-time estimate — the offline fallback when the Google Routes API is
 * unavailable. Mirrors the planner design's heuristic: road distance ≈ straight-line × 1.32,
 * ~38 km/h on Mauritian roads. Good enough to draw a route + ballpark a day; the real numbers
 * come from `getRouteLegsViaRoutes` when a Maps key is set.
 */
export interface LatLng {
  lat: number;
  lng: number;
}
export interface RouteLeg {
  km: number;
  minutes: number;
}

const EARTH_KM = 6371;
const ROAD_FACTOR = 1.32;
const AVG_KMH = 38;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function haversineLeg(a: LatLng, b: LatLng): RouteLeg {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const straightKm = 2 * EARTH_KM * Math.asin(Math.sqrt(h));
  const km = Math.max(2, Math.round(straightKm * ROAD_FACTOR));
  const minutes = Math.max(5, Math.round((km / AVG_KMH) * 60));
  return { km, minutes };
}

/** One leg per consecutive pair of points. */
export function haversineLegs(points: LatLng[]): RouteLeg[] {
  const legs: RouteLeg[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    legs.push(haversineLeg(points[i]!, points[i + 1]!));
  }
  return legs;
}
