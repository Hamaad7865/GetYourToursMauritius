import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import type { ServiceContext } from '@/lib/services/context';
import { listPlannerPlaces } from '@/lib/services/planner';

describe('planner service', () => {
  let db: TestDb;
  let ctx: ServiceContext;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    ctx = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    };
  });
  afterAll(async () => {
    await db.close();
  });

  it('listPlannerPlaces returns the curated, validated places', async () => {
    const places = await listPlannerPlaces(ctx);
    expect(places.length).toBeGreaterThanOrEqual(12);
    const cham = places.find((p) => p.id === 'chamarel-waterfall');
    expect(cham?.closesAt).toBe('17:00');
    expect(typeof cham?.lat).toBe('number');
    expect(cham?.region).toBe('South');
  });
});
