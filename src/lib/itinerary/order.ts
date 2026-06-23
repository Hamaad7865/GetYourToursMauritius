/** A geocoded point, or null when a stop couldn't be placed. */
export type MaybePoint = { lat: number; lng: number } | null;

/**
 * Nearest-neighbour visiting order over `points`, ANCHORED at index 0 (the first stop / pickup always
 * stays first). From the anchor we repeatedly hop to the closest not-yet-visited positioned point, which
 * turns an arbitrarily-typed stop list into an efficient, non-backtracking route for the map.
 *
 * Stops that couldn't be geocoded (`null`) keep their original relative order and are appended after the
 * positioned ones, so an un-resolvable stop never silently vanishes or reshuffles the rest.
 *
 * Pure + deterministic. Distance is squared planar distance with longitude scaled by cos(lat) — faithful
 * enough on an island ~60 km across that the greedy choice matches real driving proximity, and far cheaper
 * than haversine. Returns a permutation of `[0..n)`; for fewer than 3 positioned stops it returns identity
 * (nothing meaningful to reorder).
 */
export function nearestNeighborOrder(points: MaybePoint[]): number[] {
  const identity = points.map((_, i) => i);
  if (points.length < 3) return identity;

  const positioned = identity.filter((i) => points[i] !== null);
  const unpositioned = identity.filter((i) => points[i] === null);
  if (positioned.length < 3) return identity;

  const d2 = (a: number, b: number): number => {
    const p = points[a]!;
    const q = points[b]!;
    const dLat = p.lat - q.lat;
    const dLng = (p.lng - q.lng) * Math.cos((p.lat * Math.PI) / 180);
    return dLat * dLat + dLng * dLng;
  };

  const remaining = new Set(positioned);
  // Anchor on index 0 when it's positioned (the pickup / intended start); else the first positioned stop.
  let current = positioned.includes(0) ? 0 : positioned[0]!;
  const order: number[] = [current];
  remaining.delete(current);

  while (remaining.size > 0) {
    let best = -1;
    let bestD = Infinity;
    for (const j of remaining) {
      const dist = d2(current, j);
      if (dist < bestD) {
        bestD = dist;
        best = j;
      }
    }
    order.push(best);
    remaining.delete(best);
    current = best;
  }

  return [...order, ...unpositioned];
}
