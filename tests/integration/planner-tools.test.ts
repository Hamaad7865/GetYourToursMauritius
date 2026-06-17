import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import type { ServiceContext } from '@/lib/services/context';
import { resolveItinerary, searchPlannerPlaces } from '@/lib/planner/tools';

describe('planner agent tools', () => {
  let db: TestDb;
  let ctx: ServiceContext;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    ctx = { db: pgliteRpc(db.pg), payments: new StubPaymentProvider(), ai: createStubAiProvider(), now: () => new Date() };
  });
  afterAll(async () => {
    await db.close();
  });

  it('searches curated places by region, category and free text', async () => {
    const south = await searchPlannerPlaces(ctx, { region: 'South' });
    expect(south.length).toBeGreaterThan(0);
    expect(south.every((p) => p.region === 'South')).toBe(true);

    const beaches = await searchPlannerPlaces(ctx, { category: 'Beach' });
    expect(beaches.length).toBeGreaterThan(0);
    expect(beaches.every((p) => p.category === 'Beach')).toBe(true);

    const waterfalls = await searchPlannerPlaces(ctx, { query: 'waterfall' });
    expect(waterfalls.some((p) => p.id === 'chamarel-waterfall')).toBe(true);
  });

  it('resolves an ordered itinerary with a drive-time route (estimate without a maps key)', async () => {
    const r = await resolveItinerary(ctx, ['chamarel-waterfall', 'le-morne-beach', 'grand-baie-beach']);
    expect(r.places.map((p) => p.id)).toEqual(['chamarel-waterfall', 'le-morne-beach', 'grand-baie-beach']);
    expect(r.unknownIds).toEqual([]);
    expect(r.route.legs).toHaveLength(2);
    expect(r.route.estimate).toBe(true);
    expect(r.route.totalMinutes).toBeGreaterThan(0);
    expect(r.warning).toBeNull();
  });

  it('reports unknown ids instead of dropping them silently', async () => {
    const r = await resolveItinerary(ctx, ['chamarel-waterfall', 'not-a-real-place']);
    expect(r.unknownIds).toEqual(['not-a-real-place']);
    expect(r.places.map((p) => p.id)).toEqual(['chamarel-waterfall']);
  });

  it('warns past five stops', async () => {
    const six = [
      'chamarel-waterfall',
      'le-morne-beach',
      'grand-baie-beach',
      'belle-mare-beach',
      'ile-aux-cerfs',
      'trou-aux-cerfs',
    ];
    const r = await resolveItinerary(ctx, six);
    expect(r.places).toHaveLength(6);
    expect(r.warning).toMatch(/more than 5 places/i);
  });
});
