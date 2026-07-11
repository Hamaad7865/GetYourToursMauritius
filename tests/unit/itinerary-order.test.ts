import { describe, expect, it } from 'vitest';
import { nearestNeighborOrder, type MaybePoint } from '@/lib/itinerary/order';

describe('nearestNeighborOrder', () => {
  it('un-zigzags the reported south tour (Domaine, near stop 1, hops up next to it)', () => {
    // Approx coords. Trou Aux Cerfs + Domaine des Aubineaux are both in Curepipe (centre); the rest run
    // south. As typed the order is Trou(0) Grand Bassin(1) Bois Cheri(2) Domaine(3) La Vanille(4) Gris(5)
    // — which backtracks to Curepipe for #3. Anchored at Trou, the clean order is 0,3,1,2,4,5.
    const points: MaybePoint[] = [
      { lat: -20.32, lng: 57.52 }, // 0 Trou Aux Cerfs (Curepipe)
      { lat: -20.42, lng: 57.49 }, // 1 Grand Bassin
      { lat: -20.44, lng: 57.52 }, // 2 Bois Cheri
      { lat: -20.31, lng: 57.53 }, // 3 Domaine des Aubineaux (Curepipe)
      { lat: -20.49, lng: 57.55 }, // 4 La Vanille
      { lat: -20.52, lng: 57.52 }, // 5 Gris Gris
    ];
    expect(nearestNeighborOrder(points)).toEqual([0, 3, 1, 2, 4, 5]);
  });

  it('always keeps index 0 first (the pickup / intended start is the anchor)', () => {
    const points: MaybePoint[] = [
      { lat: -20.16, lng: 57.5 }, // 0 anchor in the north
      { lat: -20.52, lng: 57.52 }, // far south
      { lat: -20.18, lng: 57.51 }, // near the anchor
      { lat: -20.49, lng: 57.55 }, // south
    ];
    expect(nearestNeighborOrder(points)[0]).toBe(0);
  });

  it('returns identity for fewer than 3 stops', () => {
    expect(
      nearestNeighborOrder([
        { lat: 1, lng: 1 },
        { lat: 2, lng: 2 },
      ]),
    ).toEqual([0, 1]);
    expect(nearestNeighborOrder([])).toEqual([]);
  });

  it('keeps un-geocodable (null) stops in original order, appended after the placed ones', () => {
    const points: MaybePoint[] = [
      { lat: -20.16, lng: 57.5 }, // 0
      null, // 1 — couldn't geocode
      { lat: -20.18, lng: 57.51 }, // 2 (nearest to 0)
      { lat: -20.52, lng: 57.52 }, // 3
    ];
    const order = nearestNeighborOrder(points);
    expect(order[0]).toBe(0);
    expect(order[order.length - 1]).toBe(1); // the null stop is appended last
    expect([...order].sort()).toEqual([0, 1, 2, 3]); // a true permutation, nothing dropped
  });

  it('no-ops (identity) when fewer than 3 stops have coordinates', () => {
    const points: MaybePoint[] = [
      { lat: -20.16, lng: 57.5 },
      null,
      null,
      { lat: -20.5, lng: 57.5 },
    ];
    expect(nearestNeighborOrder(points)).toEqual([0, 1, 2, 3]);
  });
});
