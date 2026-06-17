import { haversineLeg, type LatLng, type RouteLeg } from '@/lib/maps/haversine';

export interface RouteSeg extends RouteLeg {
  from: LatLng;
  to: LatLng;
}
export interface PlannerRouteCalc {
  segs: RouteSeg[];
  totalKm: number;
  totalMinutes: number;
  visitMinutes: number;
}

/**
 * Build the round-trip route pickup → stops (in order) → back to pickup, with a leg per hop. Drive
 * times use the same haversine heuristic as the design (road factor 1.32, ~38 km/h); the booking
 * re-times against Google server-side, so this stays a fast, offline display estimate.
 */
export function computePlannerRoute(
  pickup: LatLng,
  stops: Array<LatLng & { durationMin: number }>,
): PlannerRouteCalc {
  const pts: LatLng[] = [pickup, ...stops, pickup];
  const segs: RouteSeg[] = [];
  let totalKm = 0;
  let totalMinutes = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const leg = haversineLeg(pts[i]!, pts[i + 1]!);
    segs.push({ ...leg, from: pts[i]!, to: pts[i + 1]! });
    totalKm += leg.km;
    totalMinutes += leg.minutes;
  }
  const visitMinutes = stops.reduce((s, p) => s + p.durationMin, 0);
  return { segs, totalKm, totalMinutes, visitMinutes };
}
