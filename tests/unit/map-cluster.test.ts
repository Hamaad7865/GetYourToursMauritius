import { describe, expect, it } from 'vitest';
import { clusterByGrid, projectToPixels } from '@/components/maps/cluster';
import { transfers } from '@/lib/content/transfers';

/* Grid clustering for the airport-transfers map. Measuring the real pixel geometry showed 45
 * resorts on a few coastlines produce 171 overlapping pairs at the opening zoom even as bare price
 * chips — a density problem no label size can fix. These tests pin the behaviour that replaces it,
 * and they matter more than usual because the preview pane cannot composite Maps tiles, so this is
 * the only place the logic gets verified. */

const PINNED = transfers.filter(
  (t): t is (typeof transfers)[number] & { lat: number; lng: number } =>
    typeof t.lat === 'number' && typeof t.lng === 'number',
);

describe('projectToPixels', () => {
  it('doubles the world size for each zoom level', () => {
    const a = projectToPixels(-20.2, 57.5, 9);
    const b = projectToPixels(-20.2, 57.5, 10);
    expect(b.x / a.x).toBeCloseTo(2, 5);
    expect(b.y / a.y).toBeCloseTo(2, 5);
  });

  it('places longitude 0 at the centre of the world', () => {
    expect(projectToPixels(0, 0, 0).x).toBeCloseTo(128, 5);
    expect(projectToPixels(0, 0, 0).y).toBeCloseTo(128, 5);
  });

  it('survives the poles instead of returning Infinity', () => {
    expect(Number.isFinite(projectToPixels(90, 0, 8).y)).toBe(true);
    expect(Number.isFinite(projectToPixels(-90, 0, 8).y)).toBe(true);
  });
});

describe('clusterByGrid', () => {
  it('keeps every point — clustering groups, it never drops', () => {
    for (const zoom of [8, 9, 10, 12, 14]) {
      const total = clusterByGrid(PINNED, zoom).reduce((n, c) => n + c.members.length, 0);
      expect(total).toBe(PINNED.length);
    }
  });

  it('splits clusters apart as you zoom in, never the reverse', () => {
    const counts = [8, 9, 10, 11, 12, 13, 14].map((z) => clusterByGrid(PINNED, z).length);
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
  });

  it('actually thins the opening view — the whole point of the change', () => {
    // At the zoom the island fits, 45 pins must resolve to something a map can show legibly.
    const opening = clusterByGrid(PINNED, 9);
    expect(opening.length).toBeLessThan(PINNED.length / 2);
  });

  it('eventually separates every resort at high zoom', () => {
    const deep = clusterByGrid(PINNED, 16);
    expect(deep.length).toBe(PINNED.length);
    expect(deep.every((c) => c.members.length === 1)).toBe(true);
  });

  it('puts the bubble at the centroid of its members', () => {
    const pts = [
      { lat: -20.0, lng: 57.0 },
      { lat: -20.2, lng: 57.4 },
    ];
    // One cell at a coarse zoom, so both land together.
    const [c] = clusterByGrid(pts, 4);
    expect(c!.members).toHaveLength(2);
    expect(c!.lat).toBeCloseTo(-20.1, 6);
    expect(c!.lng).toBeCloseTo(57.2, 6);
  });

  it('is stable: same input, same order, same grouping', () => {
    const a = clusterByGrid(PINNED, 10);
    const b = clusterByGrid(PINNED, 10);
    expect(b.map((c) => c.members.map((m) => m.slug))).toEqual(
      a.map((c) => c.members.map((m) => m.slug)),
    );
  });

  it('a larger cell groups at least as aggressively as a smaller one', () => {
    expect(clusterByGrid(PINNED, 10, 128).length).toBeLessThanOrEqual(
      clusterByGrid(PINNED, 10, 32).length,
    );
  });

  it('handles the empty and single-point cases', () => {
    expect(clusterByGrid([], 10)).toEqual([]);
    const [only] = clusterByGrid([{ lat: -20.2, lng: 57.5 }], 10);
    expect(only!.members).toHaveLength(1);
  });
});
