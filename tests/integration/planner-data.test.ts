import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * The curated `planner_places` table is the AI Road Trip Planner's grounding data — a seeded set of
 * real Mauritius POIs (free-form, distinct from per-tour itinerary stops). `api_planner_places`
 * exposes it (public read). This checks the seed + the RPC shape against the real schema.
 */

interface PlaceDto {
  id: string;
  name: string;
  category: string;
  region: string;
  lat: number;
  lng: number;
  durationMin: number;
  closesAt: string | null;
  blurb: string | null;
}

async function rpc<T>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [JSON.stringify(params)]);
  return rows[0]!.data;
}

describe('planner_places data layer', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await db.as(null); // anonymous public read
  });
  afterAll(async () => {
    await db.close();
  });

  it('seeds curated places readable by the public, with coords inside Mauritius', async () => {
    const places = await rpc<PlaceDto[]>(db, 'api_planner_places', {});
    expect(places.length).toBeGreaterThanOrEqual(30);
    for (const p of places) {
      expect(p.lat).toBeGreaterThan(-20.7);
      expect(p.lat).toBeLessThan(-19.8);
      expect(p.lng).toBeGreaterThan(57.2);
      expect(p.lng).toBeLessThan(57.9);
      expect(p.durationMin).toBeGreaterThan(0);
    }
  });

  it('exposes closing times as HH:MM and leaves open-access places null', async () => {
    const places = await rpc<PlaceDto[]>(db, 'api_planner_places', {});
    const garden = places.find((p) => p.id === 'pamplemousses-botanical-garden');
    expect(garden?.closesAt).toBe('17:30');
    const leMorne = places.find((p) => p.id === 'le-morne-beach');
    expect(leMorne?.closesAt).toBeNull();
  });
});
