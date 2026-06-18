import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveItinerary, searchPlannerPlaces } from '@/lib/planner/tools';
import { clearPlacesCache } from '@/lib/maps/places-cache';
import type { PlannerPlace } from '@/lib/validation/planner';

/**
 * The co-pilot tools over LIVE Google Places, with a mocked fetch (CI-safe — no real API calls). The
 * pure mappers are covered in google-places.test.ts; here we pin the tool behaviour: key handling,
 * region filtering, the discovered-cache resolution path, Place Details fallback, and the warning.
 */
const RAW_SOUTH = [
  { id: 'p-lemorne', displayName: { text: 'Le Morne Beach' }, location: { latitude: -20.45, longitude: 57.31 }, types: ['beach'] },
  { id: 'p-cham', displayName: { text: 'Chamarel Waterfall' }, location: { latitude: -20.44, longitude: 57.38 }, types: [] },
];
const place = (id: string, lat: number, lng: number): PlannerPlace => ({
  id, name: id, category: 'Beach', region: 'South', lat, lng, durationMin: 60, closesAt: null, blurb: null, imageUrl: null,
});
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  clearPlacesCache();
});

describe('searchPlannerPlaces', () => {
  it('returns [] without an API key (no fetch)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await searchPlannerPlaces({ query: 'beach' }, null)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('maps live results and region-filters', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ places: RAW_SOUTH })));
    const all = await searchPlannerPlaces({ query: 'south' }, 'key');
    expect(all.map((p) => p.id)).toEqual(['p-lemorne', 'p-cham']);
    expect(all.every((p) => p.region === 'South')).toBe(true);
    const north = await searchPlannerPlaces({ region: 'North' }, 'key');
    expect(north).toEqual([]); // both raw places are South
  });

  it('caches identical searches (no second API call) and shares across region variants', async () => {
    const fetchSpy = vi.fn(async () => ok({ places: RAW_SOUTH }));
    vi.stubGlobal('fetch', fetchSpy);
    await searchPlannerPlaces({ query: 'south', category: 'Beach' }, 'key');
    await searchPlannerPlaces({ query: 'south', category: 'Beach' }, 'key'); // identical → cache hit
    await searchPlannerPlaces({ query: 'south', category: 'Beach', region: 'South' }, 'key'); // region variant → same cache
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('resolveItinerary', () => {
  it('resolves cached ids with a haversine route (no key → no fetch)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const discovered = new Map([
      ['a', place('a', -20.45, 57.31)],
      ['b', place('b', -20.44, 57.38)],
    ]);
    const r = await resolveItinerary(['a', 'b'], discovered, null);
    expect(r.places.map((p) => p.id)).toEqual(['a', 'b']);
    expect(r.unknownIds).toEqual([]);
    expect(r.route.legs).toHaveLength(1);
    expect(r.route.estimate).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('fetches Place Details for uncached ids and reports unknowns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('routes.googleapis')) return ok({ routes: [] }); // Routes API → parse fails → haversine
        if (u.includes('/v1/places/') && u.includes('p-cham'))
          return ok({ id: 'p-cham', displayName: { text: 'Chamarel Waterfall' }, location: { latitude: -20.44, longitude: 57.38 }, types: [] });
        return { ok: false, json: async () => ({}) } as unknown as Response;
      }),
    );
    const r = await resolveItinerary(['p-cham', 'missing'], new Map(), 'key');
    expect(r.places.map((p) => p.id)).toEqual(['p-cham']);
    expect(r.unknownIds).toEqual(['missing']);
  });

  it('warns past five stops', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const discovered = new Map<string, PlannerPlace>();
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = `s${i}`;
      ids.push(id);
      discovered.set(id, place(id, -20.4 - i * 0.01, 57.3 + i * 0.01));
    }
    const r = await resolveItinerary(ids, discovered, null);
    expect(r.places).toHaveLength(6);
    expect(r.warning).toMatch(/more than 5 places/i);
  });
});
