import { describe, expect, it } from 'vitest';
import { scriptedModel } from '../helpers/scripted-model';
import {
  buildAssistantTools,
  runAdminAssistant,
  type AssistantGrants,
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

const ALL: AssistantGrants = { tours: true, quotes: true };

/** The full tool set, for the tests about what each tool does (grants are tested separately below). */
function fullTools(port: AssistantPort, collect: (a: AssistantAction) => void = () => {}) {
  return buildAssistantTools(port, collect, ALL) as Required<
    ReturnType<typeof buildAssistantTools>
  >;
}

const CALL = { toolCallId: 'test', messages: [] } as never;

/** Runs one tool the way the loop would. AI SDK v5 types `execute` as possibly streaming
 *  (AsyncIterable); none of ours do, so the awaited value is the plain result. */
async function run<I, O>(
  t: { execute?: (input: I, options: never) => O | PromiseLike<O> | AsyncIterable<O> },
  input: I,
  _options: unknown = CALL,
): Promise<O> {
  return (await t.execute!(input, CALL)) as O;
}

describe('the assistant proposes but never writes', () => {
  it('exposes exactly the expected tools — a new mutating tool must be a deliberate change', () => {
    const tools = fullTools(makePort(), () => {});
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
      const tools = fullTools(makePort(), () => {});
      const out = await run(tools.tour_pricing, { slug: 'south-tour', guests: 2 });
      expect(out).toMatchObject({
        found: true,
        pricing: { pricingMode: 'vehicle', vehicle: { vehicle: 'Sedan', totalEur: 90, guests: 2 } },
      });
    });

    it('defaults to a party of 2 and clamps a nonsense party instead of throwing', async () => {
      const tools = fullTools(makePort(), () => {});
      const noGuests = await run(tools.tour_pricing, { slug: 'south-tour' });
      expect(noGuests.pricing!.vehicle!.guests).toBe(2);
      // A model slip must be corrected, never surfaced as a 500 (see the eslint rule on bounds).
      const silly = await run(tools.tour_pricing, { slug: 'south-tour', guests: 0 });
      expect(silly.pricing!.vehicle!.guests).toBe(1);
      const huge = await run(tools.tour_pricing, { slug: 'south-tour', guests: 900 });
      expect(huge.pricing!.vehicle!.guests).toBe(25);
    });

    it('reports an unknown tour rather than pricing something else', async () => {
      const tools = fullTools(makePort(), () => {});
      const out = await run(tools.tour_pricing, { slug: 'no-such-tour', guests: 2 });
      expect(out.found).toBe(false);
    });

    it('relays `unavailable` instead of a number when pricing is not configured', async () => {
      const tools = fullTools(
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
      const out = await run(tools.tour_pricing, { slug: 'south-tour', guests: 2 });
      expect(out.pricing!.unavailable).toMatch(/no vehicle pricing/i);
      expect(out.pricing!.vehicle).toBeUndefined();
    });
  });

  it('search_catalogue carries the from-price, so a price question has an anchor', async () => {
    const tools = fullTools(makePort(), () => {});
    const out = await run(tools.search_catalogue, { query: 'catamaran' });
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
    const tools = fullTools(explodingPort, (a) => collected.push(a));
    const out = await run(
      tools.propose_new_tour,
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
    const tools = fullTools(makePort(), (a) => collected.push(a));
    const out = await run(
      tools.propose_new_tour,
      { label: 'Create tour', patch: { summary: 'no title here' } },
      CALL,
    );
    expect(out.proposed).toBe(false);
    expect(collected).toHaveLength(0);
  });

  it('propose_tour_update resolves the tour first and refuses an unknown slug', async () => {
    const collected: AssistantAction[] = [];
    const tools = fullTools(makePort(), (a) => collected.push(a));

    const ok = await run(
      tools.propose_tour_update,
      {
        label: 'Copy the highlights across',
        slug: 'catamaran-ile-aux-cerfs',
        patch: { highlights: ['A', 'B'] },
      },
      CALL,
    );
    expect(ok.proposed).toBe(true);
    expect(collected[0]).toMatchObject({ kind: 'update_tour', activityId: 'act-1' });

    const bad = await run(
      tools.propose_tour_update,
      { label: 'x', slug: 'no-such-tour', patch: { summary: 'y' } },
      CALL,
    );
    expect(bad.proposed).toBe(false);
    expect(collected).toHaveLength(1);
  });

  it('read_tour returns the real text, which is what makes "copy from X" a copy and not a paraphrase', async () => {
    const tools = fullTools(makePort(), () => {});
    const out = await run(tools.read_tour, { slug: 'catamaran-ile-aux-cerfs' });
    expect(out.found).toBe(true);
    expect(out.tour?.highlights).toEqual(TOURS['catamaran-ile-aux-cerfs']!.highlights);
  });

  it('draft_quote_from_email hands the thread back verbatim — no summarising, no pricing', async () => {
    const collected: AssistantAction[] = [];
    const tools = fullTools(makePort(), (a) => collected.push(a));
    const email = 'Hello, we are 4 adults and 2 children for the catamaran on 20 October. Thanks!';
    await run(tools.draft_quote_from_email, { label: 'Draft a quote', email });
    expect(collected[0]).toMatchObject({ kind: 'draft_quote_from_email', email });
  });
});

/* The assistant section lets a member ASK; it does not let them WRITE. The browser applies a proposal as
 * the member, so a role with the assistant but not Tours could have the model draft and apply tour
 * edits (RLS aside), and a role without Quotes could be walked to a screen it cannot open. The server
 * therefore withholds the tool from the model — these pin that on the list the model is actually given. */
describe('the caller’s sections decide which proposals the model is offered', () => {
  const TOUR_TOOLS = ['propose_new_tour', 'propose_tour_update'];
  const QUOTE_TOOL = 'draft_quote_from_email';
  const READ_ONLY = [
    'activity_departures',
    'lookup_booking',
    'lookup_quote',
    'read_tour',
    'rental_fleet',
    'search_catalogue',
    'tour_pricing',
    'transfer_fare',
  ];
  const ctx = {
    ai: { name: 'stub' },
    locale: 'en',
    now: () => new Date('2026-08-08T10:00:00Z'),
  } as unknown as ServiceContext;

  const names = (grants: AssistantGrants) =>
    Object.keys(buildAssistantTools(makePort(), () => {}, grants)).sort();

  it('without Tours or Quotes the model gets the read-only tools and no proposals at all', () => {
    expect(names({ tours: false, quotes: false })).toEqual(READ_ONLY);
  });

  it('Tours adds the two tour-writing tools, and only those', () => {
    expect(names({ tours: true, quotes: false })).toEqual([...READ_ONLY, ...TOUR_TOOLS].sort());
  });

  it('Quotes adds the quote drafter, and only that', () => {
    expect(names({ tours: false, quotes: true })).toEqual([...READ_ONLY, QUOTE_TOOL].sort());
  });

  it('with both sections the full set is offered', () => {
    expect(names(ALL)).toEqual([...READ_ONLY, ...TOUR_TOOLS, QUOTE_TOOL].sort());
  });

  it('the remaining tools keep their model-facing shape whatever the grants', () => {
    type Described = Record<string, { description?: string; inputSchema?: unknown }>;
    const full: Described = buildAssistantTools(makePort(), () => {}, ALL);
    const bare: Described = buildAssistantTools(makePort(), () => {}, {
      tours: false,
      quotes: false,
    });
    for (const name of READ_ONLY) {
      expect(bare[name]!.description).toBe(full[name]!.description);
      expect(JSON.stringify(bare[name]!.inputSchema)).toBe(JSON.stringify(full[name]!.inputSchema));
    }
  });

  it('runAdminAssistant hands the model exactly that list (and not the tools in the prompt either)', async () => {
    const offered = async (grants: AssistantGrants, path: string) => {
      const { model, seenTools, seenPrompts } = scriptedModel([{ text: 'ok' }]);
      await runAdminAssistant(
        ctx,
        makePort(),
        {
          messages: [{ role: 'user', content: 'hi' }],
          page: { path, screen: 'Somewhere' },
          grants,
        },
        model,
      );
      return { tools: seenTools[0]!.slice().sort(), prompt: seenPrompts.join(' ') };
    };

    const none = await offered({ tours: false, quotes: false }, '/admin/quotes');
    expect(none.tools).toEqual(READ_ONLY);
    // Neither the quotes-screen nudge nor the tours-screen nudge may name a tool the model lacks.
    expect(none.prompt).not.toContain('draft_quote_from_email');
    expect(
      (await offered({ tours: false, quotes: false }, '/admin/activities')).prompt,
    ).not.toContain('propose_new_tour');

    const tours = await offered({ tours: true, quotes: false }, '/admin/activities');
    expect(tours.tools).toEqual([...READ_ONLY, ...TOUR_TOOLS].sort());
    expect(tours.prompt).toContain('propose_new_tour');

    const quotes = await offered({ tours: false, quotes: true }, '/admin/quotes');
    expect(quotes.tools).toEqual([...READ_ONLY, QUOTE_TOOL].sort());
    expect(quotes.prompt).toContain('draft_quote_from_email');
  });

  it('a model that calls a withheld tool anyway gets the soft landing and proposes nothing', async () => {
    const { model } = scriptedModel([
      {
        calls: [
          {
            toolName: 'propose_new_tour',
            input: { label: 'Create tour', patch: { title: 'Sneaky tour' } },
          },
        ],
      },
    ]);
    const result = await runAdminAssistant(
      ctx,
      makePort(),
      {
        messages: [{ role: 'user', content: 'make a tour' }],
        grants: { tours: false, quotes: false },
      },
      model,
    );
    expect(result.actions).toEqual([]);
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
      grants: ALL,
    });
    expect(result).toEqual({ available: false, reply: null, actions: [] });
  });

  it('grounds the prompt in today, the rules, the screen and what is on it', async () => {
    const { model, seenPrompts } = scriptedModel([{ text: 'Adults are €55 on that departure.' }]);
    const result = await runAdminAssistant(
      ctx,
      makePort(),
      {
        messages: [{ role: 'user', content: 'what does it cost?' }],
        page: { path: '/admin/quotes', screen: 'Quotes', detail: 'Quote QTEST · total €325.00' },
        grants: ALL,
      },
      model,
    );
    expect(result.available).toBe(true);
    expect(result.reply).toContain('€55');
    const seen = seenPrompts.join(' ');
    expect(seen).toContain('2026-08-08');
    expect(seen).toContain('NEVER invent');
    expect(seen).toContain('Quotes screen');
    expect(seen).toContain('Quote QTEST');
    // On the quotes screen it must volunteer the email→quote path without being asked.
    expect(seen).toContain('draft_quote_from_email');
  });

  it('never leaves a blank bubble when the model answers with tools only', async () => {
    const { model } = scriptedModel([{ text: '' }]);
    const result = await runAdminAssistant(
      ctx,
      makePort(),
      { messages: [{ role: 'user', content: 'hm' }], grants: ALL },
      model,
    );
    expect(result.reply).toBeTruthy();
  });
});
