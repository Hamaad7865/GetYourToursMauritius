import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import type { LanguageModelV1, LanguageModelV1CallOptions } from 'ai';
import { runPlannerTurn } from '@/lib/services/planner-agent';
import type { ServiceContext } from '@/lib/services/context';
import type { PlannerPlace, PlannerTrip } from '@/lib/validation/planner';
import type { PlannedRoute } from '@/lib/maps/route-planning';
import type { BmtCandidate } from '@/lib/planner/our-activities';

/* The agent loop scripted end-to-end without Gemini or Google: the model is a MockLanguageModelV1
 * that replays tool calls, and the billed tool internals (Places search, route planning, catalogue
 * availability) are mocked. This proves the range-mode CONTRACT — commits merge by date, an invented
 * activity slug can never survive, one activity never lands on two days — which is the part that must
 * hold when the real model misbehaves. */

const fakeRoute: PlannedRoute = { legs: [], totalKm: 30, totalMinutes: 55, estimate: false };

vi.mock('@/lib/planner/tools', () => ({
  searchPlannerPlaces: vi.fn(async () => []),
  // Resolves strictly from the turn's `discovered` map (seeded by the trip input in these tests) and
  // reports the rest as unknown — mirroring the real resolver's contract without Google.
  resolveItinerary: vi.fn(async (placeIds: string[], discovered: Map<string, PlannerPlace>) => ({
    places: placeIds.map((id) => discovered.get(id)).filter((p): p is PlannerPlace => Boolean(p)),
    unknownIds: placeIds.filter((id) => !discovered.has(id)),
    rejectedFarRegion: [],
    droppedOverCap: [],
    route: fakeRoute,
  })),
}));

const CANDIDATE: BmtCandidate = {
  slug: 'catamaran-bbq',
  title: 'Catamaran Cruise with BBQ',
  category: 'Catamaran cruises',
  region: 'East',
  lat: -20.2,
  lng: 57.77,
  fromPriceEur: 75,
  pricingMode: 'per_person',
  ratingAvg: 4.8,
  ratingCount: 1158,
  heroImageUrl: null,
  durationMinutes: 480,
  minAdvanceDays: 1,
  date: '2026-09-01',
  seatsLeft: 12,
};

vi.mock('@/lib/planner/our-activities', () => ({
  searchBmtActivitiesForDay: vi.fn(async (_ctx: unknown, args: { date: string }) =>
    args.date === '2026-09-01' ? [{ ...CANDIDATE, date: args.date }] : [],
  ),
}));

vi.mock('@/lib/maps/google-places', () => ({
  placeDetailsByIds: vi.fn(async () => []),
}));

const ctx = {} as ServiceContext;

const place = (id: string, name: string, region = 'East'): PlannerPlace => ({
  id,
  name,
  category: 'Beach',
  region,
  lat: -20.2,
  lng: 57.75,
  durationMin: 60,
  closesAt: null,
  blurb: null,
  imageUrl: null,
});

const trip = (over: Partial<PlannerTrip> = {}): PlannerTrip => ({
  from: '2026-09-01',
  to: '2026-09-02',
  days: [
    { date: '2026-09-01', places: [place('pl-belle-mare', 'Belle Mare Beach')] },
    { date: '2026-09-02', places: [place('pl-ile', 'Île aux Cerfs')] },
  ],
  activeDate: '2026-09-01',
  ...over,
});

/** A model that replays the given step results in order (tool calls, then a final text). */
function scriptedModel(
  steps: Array<
    | { toolName: string; args: object }
    | { toolCalls: Array<{ toolName: string; args: object }> }
    | { text: string }
  >,
): LanguageModelV1 {
  let step = 0;
  return new MockLanguageModelV1({
    doGenerate: async (_options: LanguageModelV1CallOptions) => {
      const s = steps[Math.min(step, steps.length - 1)]!;
      step += 1;
      const base = {
        rawCall: { rawPrompt: null, rawSettings: {} },
        usage: { promptTokens: 1, completionTokens: 1 },
      };
      if ('text' in s) return { ...base, finishReason: 'stop' as const, text: s.text };
      const calls = 'toolCalls' in s ? s.toolCalls : [s];
      return {
        ...base,
        finishReason: 'tool-calls' as const,
        toolCalls: calls.map((c, i) => ({
          toolCallType: 'function' as const,
          toolCallId: `call-${step}-${i}`,
          toolName: c.toolName,
          args: JSON.stringify(c.args),
        })),
      };
    },
  });
}

describe('runPlannerTurn — range mode', () => {
  it('commits days (merged, date-sorted) and anchors only a surfaced activity slug', async () => {
    const model = scriptedModel([
      { toolName: 'search_our_activities', args: { dates: ['2026-09-01', '2026-09-02'] } },
      {
        toolName: 'set_trip_plan',
        args: {
          days: [
            {
              date: '2026-09-02',
              placeIds: ['pl-ile'],
              activitySlug: 'made-up-cruise', // never surfaced → must be dropped
            },
            {
              date: '2026-09-01',
              placeIds: ['pl-belle-mare'],
              activitySlug: 'catamaran-bbq', // surfaced + available → anchors
            },
          ],
        },
      },
      { text: 'Your trip is planned!' },
    ]);

    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'Plan my Sep 1–2 trip' }], trip: trip() },
      model,
    );

    expect(result.reply).toBe('Your trip is planned!');
    expect(result.days.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(result.days[0]!.activitySlug).toBe('catamaran-bbq');
    expect(result.days[0]!.places.map((p) => p.name)).toEqual(['Belle Mare Beach']);
    expect(result.days[0]!.route.totalMinutes).toBe(55);
    expect(result.days[1]!.activitySlug).toBeNull(); // the invented slug never survives
    expect(result.recommendations.map((r) => r.slug)).toEqual(['catamaran-bbq']);
    // Single-day fields stay empty in range mode.
    expect(result.places).toEqual([]);
    expect(result.route).toBeNull();
  });

  it('never anchors the same activity on two days', async () => {
    const model = scriptedModel([
      { toolName: 'search_our_activities', args: { dates: ['2026-09-01', '2026-09-02'] } },
      {
        toolName: 'set_trip_plan',
        args: {
          days: [
            { date: '2026-09-01', placeIds: ['pl-belle-mare'], activitySlug: 'catamaran-bbq' },
            { date: '2026-09-02', placeIds: ['pl-ile'], activitySlug: 'catamaran-bbq' },
          ],
        },
      },
      { text: 'done' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'plan it' }], trip: trip() },
      model,
    );
    expect(result.days[0]!.activitySlug).toBe('catamaran-bbq');
    expect(result.days[1]!.activitySlug).toBeNull();
  });

  it('rejects a date outside the trip and keeps a pre-anchored slug without a re-search', async () => {
    const model = scriptedModel([
      {
        toolName: 'set_trip_plan',
        args: {
          days: [
            { date: '2026-12-25', placeIds: ['pl-belle-mare'] }, // not a trip date
            { date: '2026-09-01', placeIds: ['pl-belle-mare'], activitySlug: 'catamaran-bbq' },
          ],
        },
      },
      { text: 'done' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      {
        messages: [{ role: 'user', content: 'tweak day 1' }],
        trip: trip({
          days: [
            {
              date: '2026-09-01',
              places: [place('pl-belle-mare', 'Belle Mare Beach')],
              activitySlug: 'catamaran-bbq', // already anchored from a previous turn
            },
            { date: '2026-09-02', places: [] },
          ],
        }),
      },
      model,
    );
    expect(result.days.map((d) => d.date)).toEqual(['2026-09-01']);
    expect(result.days[0]!.activitySlug).toBe('catamaran-bbq');
  });

  it('resolves the dinner suggestion from the day’s known places', async () => {
    const model = scriptedModel([
      {
        toolName: 'set_trip_plan',
        args: {
          days: [{ date: '2026-09-01', placeIds: ['pl-belle-mare'], dinnerPlaceId: 'pl-ile' }],
        },
      },
      { text: 'done' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'plan' }], trip: trip() },
      model,
    );
    expect(result.days[0]!.dinner?.name).toBe('Île aux Cerfs');
  });
});

describe('runPlannerTurn — single-day mode unchanged', () => {
  it('still commits via set_itinerary with empty range-mode fields', async () => {
    const model = scriptedModel([
      { toolName: 'set_itinerary', args: { placeIds: ['pl-belle-mare'] } },
      { text: 'Day planned.' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      {
        messages: [{ role: 'user', content: 'a beach day' }],
        itinerary: [place('pl-belle-mare', 'Belle Mare Beach')],
      },
      model,
    );
    expect(result.places.map((p) => p.name)).toEqual(['Belle Mare Beach']);
    expect(result.route?.totalMinutes).toBe(55);
    expect(result.days).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it('returns the graceful fallback (all fields present) when no model is configured', async () => {
    const result = await runPlannerTurn(
      { ai: { name: 'stub', model: '' } } as unknown as ServiceContext,
      { messages: [{ role: 'user', content: 'hi' }] },
      null,
    );
    expect(result.reply).toContain("can't reach ZilAi");
    expect(result.days).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });
});
