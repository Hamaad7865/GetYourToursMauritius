import { afterEach, describe, expect, it, vi } from 'vitest';
import { haversineLeg, haversineLegs } from '@/lib/maps/haversine';
import { getRouteLegs } from '@/lib/maps/distance';
import { getRouteLegsViaRoutes } from '@/lib/maps/directions';
import { planRoute } from '@/lib/maps/route-planning';

const GRAND_BAIE = { lat: -20.0182, lng: 57.5802 };
const BELLE_MARE = { lat: -20.183, lng: 57.774 };
const LE_MORNE = { lat: -20.4563, lng: 57.3082 };

describe('haversine fallback', () => {
  it('estimates a plausible road leg between two Mauritius points', () => {
    const leg = haversineLeg(GRAND_BAIE, BELLE_MARE);
    expect(leg.km).toBeGreaterThan(20);
    expect(leg.km).toBeLessThan(60);
    expect(leg.minutes).toBeGreaterThanOrEqual(5);
  });
  it('produces one leg per consecutive pair', () => {
    expect(haversineLegs([GRAND_BAIE, BELLE_MARE, LE_MORNE])).toHaveLength(2);
    expect(haversineLegs([GRAND_BAIE])).toHaveLength(0);
  });
});

/** A Distance Matrix response whose diagonal elements are the consecutive legs. */
function matrix(legs: Array<{ km: number; min: number }>) {
  const rows = legs.map((leg, i) => ({
    elements: legs.map((_, j) =>
      i === j
        ? { status: 'OK', distance: { value: leg.km * 1000 }, duration: { value: leg.min * 60 } }
        : { status: 'ZERO_RESULTS' },
    ),
  }));
  return { status: 'OK', rows };
}

/** A Routes API (Directions v2) response: one leg per consecutive pair. */
function routes(legs: Array<{ km: number; min: number }>) {
  return { routes: [{ legs: legs.map((l) => ({ distanceMeters: l.km * 1000, duration: `${l.min * 60}s` })) }] };
}

describe('getRouteLegsViaRoutes (Routes API)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses per-leg km/minutes from the Routes response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => routes([{ km: 30, min: 45 }, { km: 50, min: 70 }]) })));
    const legs = await getRouteLegsViaRoutes([GRAND_BAIE, BELLE_MARE, LE_MORNE], 'KEY');
    expect(legs).toEqual([{ km: 30, minutes: 45 }, { km: 50, minutes: 70 }]);
  });

  it('throws on a non-OK status (planRoute then falls back)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
    await expect(getRouteLegsViaRoutes([GRAND_BAIE, BELLE_MARE], 'KEY')).rejects.toThrow();
  });
});

describe('getRouteLegs (Distance Matrix)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses consecutive-leg km/minutes from the matrix diagonal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => matrix([{ km: 30, min: 45 }, { km: 50, min: 70 }]) })),
    );
    const legs = await getRouteLegs([GRAND_BAIE, BELLE_MARE, LE_MORNE], 'KEY');
    expect(legs).toEqual([{ km: 30, minutes: 45 }, { km: 50, minutes: 70 }]);
  });

  it('throws on a non-OK API status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'REQUEST_DENIED', rows: [] }) })));
    await expect(getRouteLegs([GRAND_BAIE, BELLE_MARE], 'KEY')).rejects.toThrow();
  });
});

describe('planRoute', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to haversine when no key is set (flagged as an estimate)', async () => {
    const route = await planRoute([GRAND_BAIE, BELLE_MARE, GRAND_BAIE]);
    expect(route.estimate).toBe(true);
    expect(route.legs).toHaveLength(2);
    expect(route.totalMinutes).toBe(route.legs[0]!.minutes + route.legs[1]!.minutes);
  });

  it('uses the Routes API when available (not an estimate)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => routes([{ km: 42, min: 55 }]) })));
    const route = await planRoute([GRAND_BAIE, BELLE_MARE], 'KEY');
    expect(route.estimate).toBe(false);
    expect(route.totalMinutes).toBe(55);
    expect(route.totalKm).toBe(42);
  });

  it('falls back to Distance Matrix when Routes is unavailable', async () => {
    // First call (Routes) returns a DM-shaped body → parse fails; the same mock then serves DM.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => matrix([{ km: 30, min: 45 }]) })));
    const route = await planRoute([GRAND_BAIE, BELLE_MARE], 'KEY');
    expect(route.estimate).toBe(false);
    expect(route.totalMinutes).toBe(45);
    expect(route.totalKm).toBe(30);
  });

  it('falls back to haversine when the API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const route = await planRoute([GRAND_BAIE, BELLE_MARE], 'KEY');
    expect(route.estimate).toBe(true);
    expect(route.legs).toHaveLength(1);
  });
});
