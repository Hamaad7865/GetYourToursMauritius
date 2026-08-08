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
  summary: null,
  imageUrls: [],
  durationMinutes: 480,
  minAdvanceDays: 1,
  date: '2026-09-01',
  seatsLeft: 12,
};

vi.mock('@/lib/planner/our-activities', () => ({
  // Mirrors the real contract: a null date returns catalogue facts with date/seatsLeft null (the
  // visitor hasn't chosen a day), never a probe of some default date.
  searchBmtActivitiesForDay: vi.fn(async (_ctx: unknown, args: { date: string | null }) => {
    if (args.date === null) return [{ ...CANDIDATE, date: null, seatsLeft: null }];
    return args.date === '2026-09-01' ? [{ ...CANDIDATE, date: args.date }] : [];
  }),
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

  it('accepts an explicit null for the optional day fields', async () => {
    // Gemini sends `"activitySlug": null` for "this day has no activity" rather than omitting the
    // key. Zod's `.optional()` accepts undefined but NOT null, so the whole turn died in argument
    // validation — a 500 for a plan that was otherwise perfectly good. (error_logs, 2026-08-08.)
    const model = scriptedModel([
      {
        toolName: 'set_trip_plan',
        args: {
          days: [
            {
              date: '2026-09-01',
              placeIds: ['pl-belle-mare'],
              activitySlug: null,
              dinnerPlaceId: null,
            },
          ],
        },
      },
      { text: 'done' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'just the beach' }], trip: trip() },
      model,
    );
    expect(result.days.map((d) => d.date)).toEqual(['2026-09-01']);
    expect(result.days[0]!.activitySlug).toBeNull();
    expect(result.days[0]!.dinner).toBeNull();
    expect(result.days[0]!.places.map((p) => p.name)).toEqual(['Belle Mare Beach']);
  });

  it('resolves a repeated date once, keeping the last version of it', async () => {
    // The parameters no longer cap the array, so the fan-out bound has to hold in execute: resolving
    // a day calls the (billed) Routes API, and "last write per date wins" was always the semantic —
    // so a date sent twice must cost one resolution, not two.
    const { resolveItinerary } = await import('@/lib/planner/tools');
    vi.mocked(resolveItinerary).mockClear();
    const model = scriptedModel([
      {
        toolName: 'set_trip_plan',
        args: {
          days: [
            { date: '2026-09-01', placeIds: ['pl-ile'] },
            { date: '2026-09-01', placeIds: ['pl-belle-mare'] }, // same date, corrected
          ],
        },
      },
      { text: 'done' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'no, the other beach' }], trip: trip() },
      model,
    );
    expect(vi.mocked(resolveItinerary)).toHaveBeenCalledTimes(1);
    expect(result.days).toHaveLength(1);
    expect(result.days[0]!.places.map((p) => p.name)).toEqual(['Belle Mare Beach']);
  });

  it('treats a commit of no days as a conversational slip, not a server fault', async () => {
    const model = scriptedModel([
      { toolName: 'set_trip_plan', args: { days: [] } },
      { text: 'Which days would you like me to plan?' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'plan it' }], trip: trip() },
      model,
    );
    expect(result.reply).toBe('Which days would you like me to plan?');
    expect(result.days).toEqual([]);
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

  it('can ground a question about one of OUR activities — the map-pin tap path', async () => {
    // Tapping a branded pin asks ZilAi about that activity. Single-day mode has no trip dates, so
    // the tool must accept the date from the question itself and surface the real candidate — which
    // is what lets the client render a bookable card instead of the model inventing a price.
    const model = scriptedModel([
      {
        toolName: 'search_our_activities',
        args: { dates: ['2026-09-01'], q: 'Catamaran Cruise with BBQ' },
      },
      { text: 'It runs 8 hours from €75, and there are 12 seats left on 1 Sep.' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'Tell me about Catamaran Cruise with BBQ' }] },
      model,
    );
    expect(result.recommendations.map((r) => r.slug)).toEqual(['catamaran-bbq']);
    expect(result.recommendations[0]!.seatsLeft).toBe(12);
    // Asking about an activity must never quietly rewrite the day the visitor already has.
    expect(result.places).toEqual([]);
    expect(result.route).toBeNull();
  });

  it('answers about an activity WITHOUT inventing a date when the visitor has not chosen one', async () => {
    // The bug this guards: the planner seeds tomorrow's date so the quote widget works, and the pin
    // card announced "book for 4 Aug" — a day the visitor never picked. With no date the lookup must
    // stay unchecked, so nothing downstream can present a date or a seat count as settled.
    const model = scriptedModel([
      { toolName: 'search_our_activities', args: { q: 'Hiking Le Morne' } }, // no `dates`
      { text: 'It runs 3h30 from €50. Which date would you like to go?' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'Tell me about Hiking Le Morne' }] },
      model,
    );
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]!.date).toBeNull();
    expect(result.recommendations[0]!.seatsLeft).toBeNull();
  });

  it('survives a model slip that would fail the SDK’s argument validation', async () => {
    // MAX_STOPS + 1 ids. The tool DESCRIBES itself as returning "ids dropped over the 6-stop cap",
    // and resolveItinerary really does cap and report them — but a `.max(MAX_STOPS)` on the
    // parameters rejected the call before execute ever ran, so the over-cap case the tool was built
    // to handle escaped as an unhandled 500 instead. (Logged in error_logs on 2026-08-08.)
    const model = scriptedModel([
      {
        toolName: 'set_itinerary',
        args: { placeIds: ['pl-belle-mare', 'a', 'b', 'c', 'd', 'e', 'f'] },
      },
      { text: 'I trimmed it to six stops.' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      {
        messages: [{ role: 'user', content: 'add everything' }],
        itinerary: [place('pl-belle-mare', 'Belle Mare Beach')],
      },
      model,
    );
    expect(result.reply).toBe('I trimmed it to six stops.');
    expect(result.places.map((p) => p.name)).toEqual(['Belle Mare Beach']);
  });

  it('absorbs an unforeseen malformed tool call without losing what was already committed', async () => {
    // The backstop, tested through the one hole the schemas can't close: a tool name that doesn't
    // exist. Nothing in set_itinerary's parameters can pre-empt this, so it stands in for the
    // next-unforeseen-slip case the catch was written for. The day committed one step earlier must
    // survive — a model fumble on step 2 must not throw away step 1's work.
    const model = scriptedModel([
      { toolName: 'set_itinerary', args: { placeIds: ['pl-belle-mare'] } },
      { toolName: 'set_the_itinerary_please', args: {} },
    ]);
    const result = await runPlannerTurn(
      ctx,
      {
        messages: [{ role: 'user', content: 'a beach day' }],
        itinerary: [place('pl-belle-mare', 'Belle Mare Beach')],
      },
      model,
    );
    expect(result.reply).toContain('lost my thread');
    expect(result.places.map((p) => p.name)).toEqual(['Belle Mare Beach']);
  });

  it('still lets a real provider failure through — a graceful reply must not hide an outage', async () => {
    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        throw new Error('Gemini quota exceeded');
      },
    });
    await expect(
      runPlannerTurn(ctx, { messages: [{ role: 'user', content: 'hi' }] }, model),
    ).rejects.toThrow('Gemini quota exceeded');
  });

  it('offers a multi-day split, dropping an invented slug and a repeated one', async () => {
    const model = scriptedModel([
      { toolName: 'search_our_activities', args: { q: 'Catamaran' } },
      {
        toolName: 'propose_trip_days',
        args: {
          days: [
            { date: '2026-09-02', activitySlug: 'catamaran-bbq', note: 'Full day on the water' },
            { date: '2026-09-01', activitySlug: 'made-up-cruise' }, // never surfaced → no tour
            { date: 'not-a-date', activitySlug: 'catamaran-bbq' }, // junk date → whole day dropped
            { date: '2026-09-03', activitySlug: 'catamaran-bbq' }, // already used → no tour
          ],
        },
      },
      { text: 'Three days, one thing each.' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: "We're here for three days" }] },
      model,
    );
    expect(result.proposedTrip).not.toBeNull();
    expect(result.proposedTrip!.from).toBe('2026-09-01');
    expect(result.proposedTrip!.to).toBe('2026-09-03');
    // Sorted by date, and the tour survives on exactly one day — the one it was offered for.
    expect(result.proposedTrip!.days.map((d) => [d.date, d.activitySlug])).toEqual([
      ['2026-09-01', null],
      ['2026-09-02', 'catamaran-bbq'],
      ['2026-09-03', null],
    ]);
    expect(result.proposedTrip!.days[1]!.activityTitle).toBe('Catamaran Cruise with BBQ');
    expect(result.proposedTrip!.days[1]!.note).toBe('Full day on the water');
    // A proposal is an OFFER — it must not touch the day the visitor already has.
    expect(result.places).toEqual([]);
  });

  it('does not offer a split it cannot make (fewer than two real dates)', async () => {
    const model = scriptedModel([
      { toolName: 'propose_trip_days', args: { days: [{ date: '2026-09-01' }] } },
      { text: 'Which days are you here?' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'split it up' }] },
      model,
    );
    expect(result.proposedTrip).toBeNull();
  });

  it('accepts an explicit null for a day with no tour — the common case for a split', async () => {
    // propose_trip_days used `.optional()`, which admits undefined but NOT null. Gemini writes
    // `"activitySlug": null` for "nothing booked that day", and on THIS tool that is the ordinary
    // case, not an edge — a two-day split with one free day would have 500'd the whole turn. Same
    // field name, same slip that broke set_trip_plan on 2026-08-08 (error_logs).
    const model = scriptedModel([
      { toolName: 'search_our_activities', args: { q: 'Catamaran' } },
      {
        toolName: 'propose_trip_days',
        args: {
          days: [
            { date: '2026-09-01', activitySlug: 'catamaran-bbq', note: null },
            { date: '2026-09-02', activitySlug: null, note: 'A slow day on the beach' },
          ],
        },
      },
      { text: 'Two days, one tour.' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: "We're here two days" }] },
      model,
    );
    expect(result.reply).toBe('Two days, one tour.');
    expect(result.proposedTrip!.days.map((d) => [d.date, d.activitySlug])).toEqual([
      ['2026-09-01', 'catamaran-bbq'],
      ['2026-09-02', null],
    ]);
    expect(result.proposedTrip!.days[0]!.note).toBeNull();
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
    expect(result.proposedTrip).toBeNull();
  });
});

/* The failure this whole guard exists for: Gemini searched, described a lovely day in prose, and
 * committed nothing — so the visitor read "I cannot directly display a map for you. However, you can
 * easily find these locations on any map application" while their map stayed empty. */
describe('runPlannerTurn — a searched-for plan must reach the map', () => {
  it('makes the model commit when it described places without committing them', async () => {
    const model = scriptedModel([
      { toolName: 'search_places', args: { region: 'South' } },
      { text: 'I cannot directly display a map for you, but here are the names.' },
      // The repair turn:
      { toolName: 'set_itinerary', args: { placeIds: ['pl-belle-mare'] } },
      { text: '**Belle Mare Beach** is on your map — 55 min of driving.' },
    ]);
    const result = await runPlannerTurn(
      ctx,
      {
        messages: [{ role: 'user', content: 'plan me a day in the south' }],
        itinerary: [place('pl-belle-mare', 'Belle Mare Beach')],
      },
      model,
    );
    expect(result.places.map((p) => p.name)).toEqual(['Belle Mare Beach']);
    expect(result.reply).toContain('on your map');
    expect(result.reply).not.toContain('cannot');
  });

  it('leaves a pure question alone — no phantom itinerary from an answer', async () => {
    const model = scriptedModel([
      { toolName: 'search_our_activities', args: { q: 'Catamaran Cruise with BBQ' } },
      { text: 'It runs 8 hours from €75.' },
      { text: 'A REPAIR TURN RAN' }, // only reachable if the guard fired
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'Tell me about Catamaran Cruise with BBQ' }] },
      model,
    );
    expect(result.reply).toBe('It runs 8 hours from €75.');
    expect(result.places).toEqual([]);
  });

  it('keeps the original reply when the model still refuses to commit', async () => {
    const model = scriptedModel([
      { toolName: 'search_places', args: { region: 'North' } },
      { text: 'That is too far from your day — it would be a separate trip.' },
      { text: 'still not committing' }, // the repair turn, which commits nothing
    ]);
    const result = await runPlannerTurn(
      ctx,
      { messages: [{ role: 'user', content: 'add Grand Baie' }] },
      model,
    );
    expect(result.reply).toBe('That is too far from your day — it would be a separate trip.');
    expect(result.places).toEqual([]);
  });
});
