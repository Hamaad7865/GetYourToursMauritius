/**
 * Grid clustering for dense map pins.
 *
 * Written for the airport-transfers map, where 45 resorts sit on a handful of coastlines. Measuring
 * the actual pixel geometry showed the crowding is a DENSITY problem, not a label-width one: at the
 * island-wide zoom the map opens at, even bare 45px price chips produced 171 overlapping pairs, and
 * full name pills produced 222. Shrinking labels cannot fix that — at that scale the resorts are
 * physically within a few pixels of each other. Grouping them can.
 *
 * Deliberately hand-rolled rather than pulling in a clustering dependency: the whole algorithm is
 * twenty lines, and keeping it pure means the behaviour is unit-testable without a DOM or a Maps
 * API key — which matters here, because the preview pane cannot composite Google Maps tiles.
 */

export interface ClusterPoint {
  lat: number;
  lng: number;
}

export interface Cluster<T extends ClusterPoint> {
  /** Centroid of the members — where the bubble sits. */
  lat: number;
  lng: number;
  members: T[];
}

const TILE = 256;

/**
 * Web Mercator world-pixel projection — the same one Google Maps uses, so a cell size in these
 * pixels corresponds to real on-screen distance.
 */
export function projectToPixels(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/**
 * Group `points` into square buckets of `cellPx` screen pixels at `zoom`. Zooming in grows the
 * pixel distance between two fixed coordinates, so clusters split apart on their own.
 *
 * Order is stable: clusters come back in first-seen order, and members keep their input order, so
 * repeated renders don't shuffle the map.
 */
export function clusterByGrid<T extends ClusterPoint>(
  points: readonly T[],
  zoom: number,
  cellPx = 64,
): Cluster<T>[] {
  const cells = new Map<string, T[]>();
  const order: string[] = [];

  for (const point of points) {
    const { x, y } = projectToPixels(point.lat, point.lng, zoom);
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(point);
    else {
      cells.set(key, [point]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const members = cells.get(key)!;
    // Centroid, so a bubble sits amongst its members rather than on whichever happened to be first.
    const lat = members.reduce((n, m) => n + m.lat, 0) / members.length;
    const lng = members.reduce((n, m) => n + m.lng, 0) / members.length;
    return { lat, lng, members };
  });
}
