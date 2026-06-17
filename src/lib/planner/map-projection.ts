/**
 * Stylized Mauritius map projection — ported verbatim from the design handoff so the SVG island,
 * pins and route line up exactly. Pure (no DOM): projects a lng/lat onto the 760×1000 SVG viewBox
 * used by `MauritiusMap`, and carries the hand-traced island outline.
 */
export interface LngLat {
  lng: number;
  lat: number;
}
export interface ProjectedPoint {
  x: number;
  y: number;
}

/** Projection bounds (the design's `BX`). */
export const MAP_BOX = { lngMin: 57.29, lngMax: 57.81, latMin: -20.55, latMax: -19.95, w: 760, h: 1000 };

/** Hand-traced Mauritius outline (the design's `OUTLINE`), as [lng, lat] pairs. */
export const MAURITIUS_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [57.55, -19.99], [57.62, -19.98], [57.7, -20.02], [57.75, -20.1], [57.79, -20.2], [57.8, -20.28],
  [57.74, -20.4], [57.66, -20.47], [57.55, -20.52], [57.45, -20.52], [57.34, -20.48], [57.31, -20.4],
  [57.34, -20.33], [57.33, -20.27], [57.38, -20.2], [57.44, -20.17], [57.49, -20.13], [57.5, -20.07],
  [57.52, -20.02],
];

/** Project a lng/lat onto the SVG viewBox. */
export function projectToMap(lng: number, lat: number): ProjectedPoint {
  const b = MAP_BOX;
  return {
    x: ((lng - b.lngMin) / (b.lngMax - b.lngMin)) * b.w,
    y: ((b.latMax - lat) / (b.latMax - b.latMin)) * b.h,
  };
}

/** The island outline as an SVG path string (closed). */
export function outlinePath(): string {
  return (
    MAURITIUS_OUTLINE.map((c, i) => {
      const p = projectToMap(c[0], c[1]);
      return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }).join(' ') + ' Z'
  );
}
