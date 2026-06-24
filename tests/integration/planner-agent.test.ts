import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import type { ServiceContext } from '@/lib/services/context';
import { runPlannerTurn } from '@/lib/services/planner-agent';
import { clearPlacesCache } from '@/lib/maps/places-cache';
import { resetServerEnvCache } from '@/lib/config/env';
import type { PlannerPlace } from '@/lib/validation/planner';

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
    expect(result.rejectedFarRegion).toEqual([]);
    expect(result.droppedOverCap).toEqual([]);
    expect(typeof result.reply).toBe('string');
    expect(result.reply.length).toBeGreaterThan(0);
  });
});

/**
 * The "add a place keeps the loaded tour" fix, with the Gemini model mocked so a turn is
 * deterministic. The agent must be told the current itinerary (so the model keeps it) and must
 * resolve those existing ids without a re-search — otherwise adding one stop wipes the rest.
 */
const place = (id: string, name: string, region = 'South'): PlannerPlace => ({
  id, name, category: 'Landmark', region, lat: -20.4, lng: 57.5,
  durationMin: 60, closesAt: null, blurb: null, imageUrl: null,
});

// runPlannerTurn only touches ctx to build the real model, which we override here — a stub is enough.
const stubCtx = { ai: { name: 'stub', model: 'stub' } } as never;

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

/** A mock Gemini that runs a fixed script (tool calls, then a reply) and records the prompts it saw. */
function scriptedModel(steps: Array<{ tool: string; args: unknown } | { text: string }>) {
  const seenPrompts: string[] = [];
  let i = 0;
  const model = new MockLanguageModelV1({
    doGenerate: async (opts) => {
      seenPrompts.push(JSON.stringify(opts.prompt));
      const step = steps[i++]!;
      if ('text' in step) {
        return {
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0 },
          text: step.text,
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      }
      return {
        finishReason: 'tool-calls',
        usage: { promptTokens: 0, completionTokens: 0 },
        toolCalls: [
          { toolCallType: 'function', toolCallId: `c${i}`, toolName: step.tool, args: JSON.stringify(step.args) },
        ],
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  });
  return { model, seenPrompts };
}

describe('runPlannerTurn — keeps the current day when adding', () => {
  beforeEach(() => {
    // A maps key makes set_itinerary resolve a newly-added id via Place Details (as in production);
    // vitest doesn't load .env, so set it explicitly and clear the memoised env so it takes effect.
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    resetServerEnvCache();
  });
  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    resetServerEnvCache();
    vi.unstubAllGlobals();
    clearPlacesCache();
  });

  it('preserves a loaded stop the model did not search this turn (add, not replace)', async () => {
    // Place Details resolves only the newly-added place; the loaded stop must come from the itinerary.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('routes.googleapis')) return okJson({ routes: [] }); // → haversine estimate
        if (u.includes('/v1/places/') && u.includes('p-new'))
          return okJson({ id: 'p-new', displayName: { text: 'Curious Mauritius' }, location: { latitude: -20.3, longitude: 57.5 }, types: [] });
        return { ok: false, json: async () => ({}) } as unknown as Response;
      }),
    );

    const loaded = place('p-loaded', 'Le Morne Beach'); // a stop loaded from the tour
    const { model } = scriptedModel([
      { tool: 'set_itinerary', args: { placeIds: ['p-loaded', 'p-new'] } },
      { text: "Added Curious Mauritius and kept Le Morne — here's your day." },
    ]);

    const res = await runPlannerTurn(
      stubCtx,
      { messages: [{ role: 'user', content: 'Add Curious Mauritius and keep the rest.' }], itinerary: [loaded] },
      model,
    );

    expect(res.places.map((p) => p.id)).toEqual(['p-loaded', 'p-new']);
  });

  it('tells the model the current itinerary (names + ids) so it can keep it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ routes: [] })));
    const loaded = place('p-loaded', 'Le Morne Beach');
    const { model, seenPrompts } = scriptedModel([{ text: 'Sure!' }]);

    await runPlannerTurn(
      stubCtx,
      { messages: [{ role: 'user', content: 'What is on my day?' }], itinerary: [loaded] },
      model,
    );

    expect(seenPrompts[0]).toContain('Le Morne Beach');
    expect(seenPrompts[0]).toContain('p-loaded');
    expect(seenPrompts[0]).toContain('at most 6'); // the 6-stop cap rule is in the system prompt
  });

  it('refuses a far-region addition and keeps the existing day', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('routes.googleapis')) return okJson({ routes: [] });
        if (u.includes('/v1/places/') && u.includes('p-north'))
          return okJson({ id: 'p-north', displayName: { text: 'Cap Malheureux' }, location: { latitude: -20.0, longitude: 57.6 }, types: [] }); // North
        return { ok: false, json: async () => ({}) } as unknown as Response;
      }),
    );
    const loaded = place('p-loaded', 'Le Morne Beach', 'South');
    const { model } = scriptedModel([
      { tool: 'set_itinerary', args: { placeIds: ['p-loaded', 'p-north'] } },
      { text: 'Cap Malheureux is up north — too far to combine with your south day.' },
    ]);
    const res = await runPlannerTurn(
      stubCtx,
      { messages: [{ role: 'user', content: 'Add Cap Malheureux' }], itinerary: [loaded] },
      model,
    );
    expect(res.places.map((p) => p.id)).toEqual(['p-loaded']);
    expect(res.rejectedFarRegion).toEqual(['Cap Malheureux']);
  });

  it('keeps the day when the model wrongly commits only a far place (accepted empty)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('routes.googleapis')) return okJson({ routes: [] });
        if (u.includes('/v1/places/') && u.includes('p-north'))
          return okJson({ id: 'p-north', displayName: { text: 'Cap Malheureux' }, location: { latitude: -20.0, longitude: 57.6 }, types: [] }); // North
        return { ok: false, json: async () => ({}) } as unknown as Response;
      }),
    );
    const loaded = place('p-loaded', 'Le Morne Beach', 'South');
    const { model } = scriptedModel([
      { tool: 'set_itinerary', args: { placeIds: ['p-north'] } },
      { text: 'That one is too far north for a south day.' },
    ]);
    const res = await runPlannerTurn(
      stubCtx,
      { messages: [{ role: 'user', content: 'Add Cap Malheureux' }], itinerary: [loaded] },
      model,
    );
    expect(res.places).toEqual([]); // nothing committed → client leaves the day untouched
    expect(res.rejectedFarRegion).toEqual(['Cap Malheureux']);
  });
});
