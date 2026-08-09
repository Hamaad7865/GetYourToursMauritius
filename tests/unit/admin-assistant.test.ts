import { describe, expect, it } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import type { LanguageModelV1 } from 'ai';
import {
  buildAssistantTools,
  runAdminAssistant,
  type AssistantPort,
  type AssistantTour,
} from '@/lib/services/admin-assistant';
import type { AssistantAction } from '@/lib/validation/admin-assistant';
import { applyPatch } from '@/lib/admin/assistant';
import { EMPTY_ACTIVITY } from '@/lib/admin/activity-write';
import type { ServiceContext } from '@/lib/services/context';

/**
 * The back-office assistant, scripted without Gemini — same shape as quote-extraction.test.ts.
 * What must hold, and is asserted here:
 *
 *  - the port is READ-ONLY and the propose_* tools WRITE NOTHING: they only collect a proposal, so
 *    a prompt-injected email has no path to a mutation;
 *  - a proposal can carry no price — the schema has no slot for one;
 *  - `applyPatch` folds ONLY the sent keys, so an update that carries just `highlights` cannot
 *    blank a description (the "copy the highlights from X" case);
 *  - the system prompt is grounded in today, the screen, and what is on it.
 */

const TOURS: Record<string, AssistantTour> = {
  'catamaran-ile-aux-cerfs': {
    id: 'act-1',
    slug: 'catamaran-ile-aux-cerfs',
    title: 'Catamaran Cruise – Ile Aux Cerfs',
    status: 'published',
    category: 'Sea',
    location: 'Trou d’Eau Douce',
    summary: 'A full day on the lagoon.',
    description: 'Long description.',
    highlights: [
      'Snorkelling at the coral garden',
      'BBQ lunch on board',
      'Île aux Cerfs beach time',
    ],
    inclusions: ['Lunch', 'Snorkelling gear'],
    exclusions: ['Drinks'],
    whatToBring: ['Towel'],
    importantInfo: ['Weather dependent'],
  },
};

function makePort(overrides: Partial<AssistantPort> = {}): AssistantPort {
  return {
    listCatalogue: async () => [
      {
        slug: 'catamaran-ile-aux-cerfs',
        title: 'Catamaran Cruise – Ile Aux Cerfs',
        category: 'Sea',
        region: 'East',
        pricingMode: 'per_person',
        fromPriceEur: 55,
      },
    ],
    tourPricing: async (slug, guests) =>
      slug === 'south-tour'
        ? {
            slug,
            title: 'Private South Tour Mauritius',
            pricingMode: 'vehicle',
            fromPriceEur: 90,
            vehicle: {
              guests,
              vehicle: guests <= 4 ? 'Sedan' : 'Van',
              totalEur: guests <= 4 ? 90 : 150,
              table: { 'Sedan 1-4': 90, 'Van 7-14': 150 },
            },
          }
        : null,
    readTour: async (slug) => (TOURS[slug] ? { ...TOURS[slug]! } : null),
    activityDepartures: async () => [],
    transferFare: async () => null,
    lookupBooking: async () => null,
    lookupQuote: async () => null,
    rentalFleet: async () => [],
    ...overrides,
  };
}

const CALL = { toolCallId: 'test', messages: [] } as never;

describe('the assistant proposes but never writes', () => {
  it('exposes exactly the expected tools — a new mutating tool must be a deliberate change', () => {
    const tools = buildAssistantTools(makePort(), () => {});
    expect(Object.keys(tools).sort()).toEqual([
      'activity_departures',
      'draft_quote_from_email',
      'lookup_booking',
      'lookup_quote',
      'propose_new_tour',
      'propose_tour_update',
      'read_tour',
      'rental_fleet',
      'search_catalogue',
      'tour_pricing',
      'transfer_fare',
    ]);
  });

  /* The back office quoted an operator "70 EUR" for a tour whose configured Sedan price is 90 — the
   * stale SIGHTSEEING_DEFAULT seed. The prompt already banned inventing figures; what was missing was
   * any tool that could price a tour WITHOUT a departure date, so the model had no honest answer to
   * give. These pin the tool that closes that hole. */
  describe('tour_pricing — a price the operator can repeat to a guest', () => {
    it('prices a sightseeing tour per VEHICLE for the party, not per person', async () => {
      const tools = buildAssistantTools(makePort(), () => {});
      const out = await tools.tour_pricing.execute!({ slug: 'south-tour', guests: 2 }, CALL);
      expect(out).toMatchObject({
        found: true,
        pricing: { pricingMode: 'vehicle', vehicle: { vehicle: 'Sedan', totalEur: 90, guests: 2 } },
      });
    });

    it('defaults to a party of 2 and clamps a nonsense party instead of throwing', async () => {
      const tools = buildAssistantTools(makePort(), () => {});
      const noGuests = await tools.tour_pricing.execute!({ slug: 'south-tour' }, CALL);
      expect(noGuests.pricing!.vehicle!.guests).toBe(2);
      // A model slip must be corrected, never surfaced as a 500 (see the eslint rule on bounds).
      const silly = await tools.tour_pricing.execute!({ slug: 'south-tour', guests: 0 }, CALL);
      expect(silly.pricing!.vehicle!.guests).toBe(1);
      const huge = await tools.tour_pricing.execute!({ slug: 'south-tour', guests: 900 }, CALL);
      expect(huge.pricing!.vehicle!.guests).toBe(25);
    });

    it('reports an unknown tour rather than pricing something else', async () => {
      const tools = buildAssistantTools(makePort(), () => {});
      const out = await tools.tour_pricing.execute!({ slug: 'no-such-tour', guests: 2 }, CALL);
      expect(out.found).toBe(false);
    });

    it('relays `unavailable` instead of a number when pricing is not configured', async () => {
      const tools = buildAssistantTools(
        makePort({
          tourPricing: async (slug) => ({
            slug,
            title: 'Unpriced tour',
            pricingMode: 'vehicle',
            fromPriceEur: null,
            unavailable: 'This sightseeing tour has no vehicle pricing configured.',
          }),
        }),
        () => {},
      );
      const out = await tools.tour_pricing.execute!({ slug: 'south-tour', guests: 2 }, CALL);
      expect(out.pricing!.unavailable).toMatch(/no vehicle pricing/i);
      expect(out.pricing!.vehicle).toBeUndefined();
    });
  });

  it('search_catalogue carries the from-price, so a price question has an anchor', async () => {
    const tools = buildAssistantTools(makePort(), () => {});
    const out = await tools.search_catalogue.execute!({ query: 'catamaran' }, CALL);
    expect(out.activities[0]).toMatchObject({ fromPriceEur: 55 });
  });

  it('propose_new_tour collects a draft proposal and touches no data', async () => {
    const collected: AssistantAction[] = [];
    // A port whose every method throws proves the propose path reads nothing at all.
    const explodingPort = makePort({
      listCatalogue: async () => {
        throw new Error('must not be called');
      },
    });
    const tools = buildAssistantTools(explodingPort, (a) => collected.push(a));
    const out = await tools.propose_new_tour.execute!(
      {
        label: 'Create draft tour "Sunset cruise"',
        patch: { title: 'Sunset cruise', summary: 'Golden hour on the lagoon.' },
      },
      CALL,
    );
    expect(out.proposed).toBe(true);
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ kind: 'create_tour' });
    // The guardrail the operator relies on: a created tour is a draft with no prices.
    expect(collected[0]!.caveat).toMatch(/draft|price/i);
  });

  it('propose_new_tour refuses a nameless tour instead of proposing junk', async () => {
    const collected: AssistantAction[] = [];
    const tools = buildAssistantTools(makePort(), (a) => collected.push(a));
    const out = await tools.propose_new_tour.execute!(
      { label: 'Create tour', patch: { summary: 'no title here' } },
      CALL,
    );
    expect(out.proposed).toBe(false);
    expect(collected).toHaveLength(0);
  });

  it('propose_tour_update resolves the tour first and refuses an unknown slug', async () => {
    const collected: AssistantAction[] = [];
    const tools = buildAssistantTools(makePort(), (a) => collected.push(a));

    const ok = await tools.propose_tour_update.execute!(
      {
        label: 'Copy the highlights across',
        slug: 'catamaran-ile-aux-cerfs',
        patch: { highlights: ['A', 'B'] },
      },
      CALL,
    );
    expect(ok.proposed).toBe(true);
    expect(collected[0]).toMatchObject({ kind: 'update_tour', activityId: 'act-1' });

    const bad = await tools.propose_tour_update.execute!(
      { label: 'x', slug: 'no-such-tour', patch: { summary: 'y' } },
      CALL,
    );
    expect(bad.proposed).toBe(false);
    expect(collected).toHaveLength(1);
  });

  it('read_tour returns the real text, which is what makes "copy from X" a copy and not a paraphrase', async () => {
    const tools = buildAssistantTools(makePort(), () => {});
    const out = await tools.read_tour.execute!({ slug: 'catamaran-ile-aux-cerfs' }, CALL);
    expect(out.found).toBe(true);
    expect(out.tour?.highlights).toEqual(TOURS['catamaran-ile-aux-cerfs']!.highlights);
  });

  it('draft_quote_from_email hands the thread back verbatim — no summarising, no pricing', async () => {
    const collected: AssistantAction[] = [];
    const tools = buildAssistantTools(makePort(), (a) => collected.push(a));
    const email = 'Hello, we are 4 adults and 2 children for the catamaran on 20 October. Thanks!';
    await tools.draft_quote_from_email.execute!({ label: 'Draft a quote', email }, CALL);
    expect(collected[0]).toMatchObject({ kind: 'draft_quote_from_email', email });
  });
});

describe('applyPatch — the fold that must not destroy work', () => {
  it('replaces only the keys that were sent', () => {
    const base = { ...EMPTY_ACTIVITY, title: 'Old', description: 'Keep me', highlights: ['old'] };
    const next = applyPatch(base, { highlights: ['new one', 'new two'] });
    expect(next.highlights).toEqual(['new one', 'new two']);
    // The whole point: a highlights-only patch leaves the description alone.
    expect(next.description).toBe('Keep me');
    expect(next.title).toBe('Old');
  });

  it('an empty patch changes nothing', () => {
    const base = { ...EMPTY_ACTIVITY, title: 'Same', summary: 'Also same' };
    expect(applyPatch(base, {})).toEqual(base);
  });

  it('a list REPLACES rather than appends — "copy the highlights from X" means exactly that', () => {
    const base = { ...EMPTY_ACTIVITY, highlights: ['a', 'b', 'c'] };
    expect(applyPatch(base, { highlights: ['x'] }).highlights).toEqual(['x']);
  });

  it('an explicit empty string clears a field, which a missing key must not', () => {
    const base = { ...EMPTY_ACTIVITY, summary: 'had one' };
    expect(applyPatch(base, { summary: '' }).summary).toBe('');
    expect(applyPatch(base, {}).summary).toBe('had one');
  });
});

describe('runAdminAssistant', () => {
  const ctx = {
    ai: { name: 'stub' },
    locale: 'en',
    now: () => new Date('2026-08-08T10:00:00Z'),
  } as unknown as ServiceContext;

  it('reports unavailable (never throws) when no model is configured', async () => {
    const result = await runAdminAssistant(ctx, makePort(), {
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result).toEqual({ available: false, reply: null, actions: [] });
  });

  it('grounds the prompt in today, the rules, the screen and what is on it', async () => {
    let seen = '';
    const model: LanguageModelV1 = new MockLanguageModelV1({
      doGenerate: async (options) => {
        seen = JSON.stringify(options.prompt);
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: 'stop' as const,
          usage: { promptTokens: 1, completionTokens: 1 },
          text: 'Adults are €55 on that departure.',
        };
      },
    });
    const result = await runAdminAssistant(
      ctx,
      makePort(),
      {
        messages: [{ role: 'user', content: 'what does it cost?' }],
        page: { path: '/admin/quotes', screen: 'Quotes', detail: 'Quote QTEST · total €325.00' },
      },
      model,
    );
    expect(result.available).toBe(true);
    expect(result.reply).toContain('€55');
    expect(seen).toContain('2026-08-08');
    expect(seen).toContain('NEVER invent');
    expect(seen).toContain('Quotes screen');
    expect(seen).toContain('Quote QTEST');
    // On the quotes screen it must volunteer the email→quote path without being asked.
    expect(seen).toContain('draft_quote_from_email');
  });

  it('never leaves a blank bubble when the model answers with tools only', async () => {
    const model: LanguageModelV1 = new MockLanguageModelV1({
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: 'stop' as const,
        usage: { promptTokens: 1, completionTokens: 1 },
        text: '',
      }),
    });
    const result = await runAdminAssistant(
      ctx,
      makePort(),
      { messages: [{ role: 'user', content: 'hm' }] },
      model,
    );
    expect(result.reply).toBeTruthy();
  });
});
