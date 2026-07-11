import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import type { ServiceContext } from '@/lib/services/context';
import { generatePlaceInsights } from '@/lib/services/place-insights';

/**
 * The real Gemini insights need a key and aren't exercised in CI (matching the stub-AI convention).
 * Here we pin the graceful fallback: with the stub provider (no model) it returns null, and an empty
 * place list returns null too — so the UI hides cleanly instead of erroring.
 */
describe('place insights (no-model fallback)', () => {
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

  it('returns null when no Gemini model is configured', async () => {
    const r = await generatePlaceInsights(ctx, [
      { name: 'Le Morne', category: 'Beach', region: 'South' },
    ]);
    expect(r).toBeNull();
  });

  it('returns null for an empty place list', async () => {
    expect(await generatePlaceInsights(ctx, [])).toBeNull();
  });
});
