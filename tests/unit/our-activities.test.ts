import { describe, expect, it } from 'vitest';
import {
  MAX_AVAILABILITY_CHECKS,
  rankBmtForDay,
  resolveActivityCoords,
  type BmtActivity,
  type CoordsSources,
} from '@/lib/planner/our-activities';

const summary = {
  slug: 'catamaran-bbq',
  title: 'Catamaran Cruise with BBQ',
  location: 'Belle Mare',
};

function sources(over: Partial<CoordsSources> = {}): CoordsSources {
  return {
    detail: async () => null,
    searchPlace: async () => null,
    ...over,
  };
}

describe('resolveActivityCoords precedence', () => {
  it('prefers the activity row’s own admin-set coords + home region', async () => {
    const r = await resolveActivityCoords(
      summary,
      sources({
        detail: async () => ({
          lat: -20.19,
          lng: 57.77,
          region: 'East',
          itinerary: [{ lat: -20.0, lng: 57.5 }],
        }),
      }),
    );
    expect(r).toEqual({ lat: -20.19, lng: 57.77, region: 'East' });
  });

  it('falls back to the first itinerary stop with coords (skipping coordless stops)', async () => {
    const r = await resolveActivityCoords(
      summary,
      sources({
        detail: async () => ({
          itinerary: [{}, { lat: -20.45, lng: 57.31 }],
        }),
      }),
    );
    expect(r.lat).toBe(-20.45);
    expect(r.lng).toBe(57.31);
    // No admin region set → classified from the resolved point (deep south-west = South).
    expect(r.region).toBe('South');
  });

  it('falls back to a Places text search of "title, location, Mauritius"', async () => {
    let query = '';
    const r = await resolveActivityCoords(
      summary,
      sources({
        searchPlace: async (q) => {
          query = q;
          return { lat: -20.01, lng: 57.58 };
        },
      }),
    );
    expect(query).toBe('Catamaran Cruise with BBQ, Belle Mare, Mauritius');
    expect(r).toEqual({ lat: -20.01, lng: 57.58, region: 'North' });
  });

  it('keeps the admin home region even when only the search resolves a point', async () => {
    const r = await resolveActivityCoords(
      summary,
      sources({
        detail: async () => ({ region: 'East' }),
        searchPlace: async () => ({ lat: -20.01, lng: 57.58 }),
      }),
    );
    expect(r.region).toBe('East');
  });

  it('returns null coords when nothing resolves (card only — never a marker at a made-up point)', async () => {
    const r = await resolveActivityCoords(summary, sources());
    expect(r).toEqual({ lat: null, lng: null, region: null });
  });

  it('treats a throwing lookup as a miss instead of failing the list', async () => {
    const r = await resolveActivityCoords(
      summary,
      sources({
        detail: async () => {
          throw new Error('rpc down');
        },
        searchPlace: async () => {
          throw new Error('places down');
        },
      }),
    );
    expect(r.lat).toBeNull();
  });
});

const act = (over: Partial<BmtActivity>): BmtActivity => ({
  slug: 'a',
  title: 'A',
  category: 'Catamaran cruises',
  region: 'East',
  lat: -20.2,
  lng: 57.77,
  fromPriceEur: 75,
  pricingMode: 'per_person',
  ratingAvg: 4.5,
  ratingCount: 100,
  heroImageUrl: null,
  durationMinutes: 480,
  minAdvanceDays: 1,
  ...over,
});

describe('rankBmtForDay', () => {
  it('drops activities whose region is far from the day (East day loses West activities)', () => {
    const kept = rankBmtForDay([act({ slug: 'east' }), act({ slug: 'west', region: 'West' })], {
      region: 'East',
    });
    expect(kept.map((a) => a.slug)).toEqual(['east']);
  });

  it('keeps near/adjacent regions and unregioned days keep everything', () => {
    const all = [act({ slug: 'east' }), act({ slug: 'north', region: 'North' })];
    expect(rankBmtForDay(all, { region: 'East' })).toHaveLength(2); // East↔North is near
    expect(rankBmtForDay(all, {})).toHaveLength(2);
  });

  it('drops an activity with an unknown region when the day has one (fail-safe, like the day rule)', () => {
    const kept = rankBmtForDay([act({ slug: 'mystery', region: null })], { region: 'East' });
    expect(kept).toHaveLength(0);
  });

  it('filters by category substring, case-insensitively', () => {
    const all = [act({ slug: 'cat' }), act({ slug: 'hike', category: 'Hiking' })];
    expect(rankBmtForDay(all, { category: 'catamaran' }).map((a) => a.slug)).toEqual(['cat']);
  });

  it('ranks best-rated first and caps the fan-out', () => {
    const all = Array.from({ length: 10 }, (_, i) => act({ slug: `a${i}`, ratingAvg: 4 + i / 10 }));
    const ranked = rankBmtForDay(all, {});
    expect(ranked).toHaveLength(MAX_AVAILABILITY_CHECKS);
    expect(ranked[0]!.slug).toBe('a9');
  });
});
