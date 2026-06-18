import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import type { ServiceContext } from '@/lib/services/context';
import { runPlannerTurn } from '@/lib/services/planner-agent';

/**
 * The real Gemini loop needs a key and isn't exercised in CI (matching the codebase's stub-AI
 * convention); its tools are unit-tested in planner-tools.test.ts. Here we pin the graceful
 * fallback: with the stub provider (no model), the turn never throws and returns a usable shape.
 */
describe('planner agent (no-model fallback)', () => {
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

  it('returns a graceful, non-throwing fallback when no Gemini model is configured', async () => {
    const result = await runPlannerTurn(ctx, {
      messages: [{ role: 'user', content: 'Plan a relaxed day in the south' }],
    });
    expect(result.places).toEqual([]);
    expect(result.route).toBeNull();
    expect(result.warning).toBeNull();
    expect(typeof result.reply).toBe('string');
    expect(result.reply.length).toBeGreaterThan(0);
  });
});
