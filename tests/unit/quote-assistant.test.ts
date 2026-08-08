import { describe, expect, it } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import type { LanguageModelV1 } from 'ai';
import {
  buildAssistantTools,
  runQuoteAssistant,
  type AssistantPort,
} from '@/lib/services/quote-assistant';
import type { ServiceContext } from '@/lib/services/context';

/**
 * The admin Gemini chat, scripted end-to-end without Gemini — the same testing shape as
 * quote-extraction.test.ts: a MockLanguageModelV1 stands in for the model, and the data port is a
 * fixture, so this proves the CONTRACT the panel relies on:
 *
 *  - with no model configured the chat reports itself unavailable rather than throwing;
 *  - the system prompt carries the grounding rules, today's date and the on-screen quote context;
 *  - every tool answers FROM THE PORT (our data), and the port has no writing method — the
 *    "figures come from tools, and nothing mutates" guardrails are structural, not aspirational.
 */

const PORT: AssistantPort = {
  listCatalogue: async () => [
    {
      slug: 'catamaran-cruise-ile-aux-cerfs',
      title: 'Catamaran Cruise – Ile Aux Cerfs',
      category: 'Sea',
      region: 'East',
      pricingMode: 'per_person',
    },
    {
      slug: 'private-south-tour',
      title: 'Private South Tour',
      category: 'Sightseeing',
      region: 'South',
      pricingMode: 'vehicle',
    },
  ],
  activityDepartures: async (slug, day) => {
    if (slug === 'catamaran-cruise-ile-aux-cerfs') {
      return [
        {
          optionName: 'Standard Sharing Basis',
          startsAt: `${day}T08:00:00.000Z`,
          tiers: [
            { label: 'Adult', eur: 55 },
            { label: 'Child', eur: 40 },
          ],
          refusal: null,
        },
      ];
    }
    if (slug === 'private-south-tour') return [];
    return null;
  },
  transferFare: async ({ activitySlug, guests, hotel, pickupRegion }) => {
    if (activitySlug !== 'catamaran-cruise-ile-aux-cerfs') return null;
    if (pickupRegion === 'Unfared')
      return { pickupRegion, activityRegion: 'East', roundTripEur: 0 };
    if (!pickupRegion && !hotel) return null;
    return {
      pickupRegion: pickupRegion ?? 'East',
      activityRegion: 'East',
      roundTripEur: guests <= 4 ? 15 : 25,
    };
  },
  lookupBooking: async (ref) =>
    ref === 'BMT123' ? { ref: 'BMT123', status: 'confirmed', totalEur: 90 } : null,
  lookupQuote: async (ref) =>
    ref === 'Q123' ? { ref: 'Q123', status: 'sent', totalEur: 55 } : null,
  rentalFleet: async () => [
    {
      slug: 'economy-auto',
      name: 'Economy (automatic)',
      category: 'car',
      transmission: 'automatic',
      dailyRateEur: 35,
    },
  ],
};

/** Tool `execute` takes (args, options); the options are irrelevant to these tools. */
const CALL = { toolCallId: 'test', messages: [] } as never;

const tools = buildAssistantTools(PORT);

describe('the assistant tools answer from the port', () => {
  it('search_catalogue filters across title/category/slug and caps the list', async () => {
    const all = await tools.search_catalogue.execute!({ query: undefined }, CALL);
    expect(all.count).toBe(2);
    const hit = await tools.search_catalogue.execute!({ query: 'cata' }, CALL);
    expect(hit.count).toBe(1);
    expect(hit.activities[0]!.slug).toBe('catamaran-cruise-ile-aux-cerfs');
    const byRegion = await tools.search_catalogue.execute!({ query: 'south' }, CALL);
    expect(byRegion.activities[0]!.slug).toBe('private-south-tour');
  });

  it('activity_departures reports real tiers, an empty day, and an unknown slug distinctly', async () => {
    const found = await tools.activity_departures.execute!(
      { slug: 'catamaran-cruise-ile-aux-cerfs', date: '2026-10-20' },
      CALL,
    );
    expect(found.found).toBe(true);
    expect(found.departures?.[0]?.tiers).toEqual([
      { label: 'Adult', eur: 55 },
      { label: 'Child', eur: 40 },
    ]);

    const none = await tools.activity_departures.execute!(
      { slug: 'private-south-tour', date: '2026-10-20' },
      CALL,
    );
    expect(none.found).toBe(true);
    expect(none.departures).toEqual([]);
    expect(none.note).toContain('No open departure');

    const unknown = await tools.activity_departures.execute!(
      { slug: 'no-such-tour', date: '2026-10-20' },
      CALL,
    );
    expect(unknown.found).toBe(false);
  });

  it('transfer_fare returns the engine figure, and flags an unconfigured (zero) fare for hand-pricing', async () => {
    const fare = await tools.transfer_fare.execute!(
      { activitySlug: 'catamaran-cruise-ile-aux-cerfs', guests: 6, pickupRegion: 'East' },
      CALL,
    );
    expect(fare.found).toBe(true);
    expect(fare).toMatchObject({ roundTripEur: 25 });
    expect(fare.note).toContain('Vehicle pricing');

    const zero = await tools.transfer_fare.execute!(
      { activitySlug: 'catamaran-cruise-ile-aux-cerfs', guests: 2, pickupRegion: 'Unfared' },
      CALL,
    );
    expect(zero.found).toBe(true);
    expect(zero.note).toContain('No fare is configured');

    const unresolved = await tools.transfer_fare.execute!(
      { activitySlug: 'catamaran-cruise-ile-aux-cerfs', guests: 2 },
      CALL,
    );
    expect(unresolved.found).toBe(false);
  });

  it('lookup_booking / lookup_quote answer found and not-found honestly', async () => {
    expect((await tools.lookup_booking.execute!({ ref: 'BMT123' }, CALL)).found).toBe(true);
    expect((await tools.lookup_booking.execute!({ ref: 'BMT999' }, CALL)).found).toBe(false);
    expect((await tools.lookup_quote.execute!({ ref: 'Q123' }, CALL)).found).toBe(true);
    expect((await tools.lookup_quote.execute!({ ref: 'Q999' }, CALL)).found).toBe(false);
  });

  it('the port is read-only by construction — no tool can write', () => {
    // The guardrail is structural: if someone adds a mutating method to the port, this list forces
    // the test (and the reviewer) to look at it.
    expect(Object.keys(tools).sort()).toEqual([
      'activity_departures',
      'lookup_booking',
      'lookup_quote',
      'rental_fleet',
      'search_catalogue',
      'transfer_fare',
    ]);
  });
});

describe('runQuoteAssistant', () => {
  const ctx = {
    ai: { name: 'stub' },
    locale: 'en',
    now: () => new Date('2026-08-08T10:00:00Z'),
  } as unknown as ServiceContext;

  it('reports unavailable (never throws) when no model is configured', async () => {
    const result = await runQuoteAssistant(ctx, PORT, {
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result).toEqual({ available: false, reply: null });
  });

  it('answers with the scripted reply, grounding the system prompt in today + the open quote', async () => {
    let seenPrompt = '';
    const model: LanguageModelV1 = new MockLanguageModelV1({
      doGenerate: async (options) => {
        seenPrompt = JSON.stringify(options.prompt);
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: 'stop' as const,
          usage: { promptTokens: 1, completionTokens: 1 },
          text: 'The catamaran departs at 12:00; adults are €55 from the catalogue.',
        };
      },
    });
    const result = await runQuoteAssistant(
      ctx,
      PORT,
      {
        messages: [{ role: 'user', content: 'What does the catamaran cost?' }],
        quoteContext: 'Quote QTEST · guest Mihai Roman · total €325.00',
      },
      model,
    );
    expect(result.available).toBe(true);
    expect(result.reply).toContain('catamaran departs');
    // The grounding contract: today's date, the rules, and the on-screen quote all reach the model.
    expect(seenPrompt).toContain('2026-08-08');
    expect(seenPrompt).toContain('NEVER invent');
    expect(seenPrompt).toContain('READ-ONLY');
    expect(seenPrompt).toContain('Quote QTEST');
  });

  it('turns an empty model reply into an honest fallback line', async () => {
    const model: LanguageModelV1 = new MockLanguageModelV1({
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: 'stop' as const,
        usage: { promptTokens: 1, completionTokens: 1 },
        text: '',
      }),
    });
    const result = await runQuoteAssistant(
      ctx,
      PORT,
      { messages: [{ role: 'user', content: 'hm' }] },
      model,
    );
    expect(result.available).toBe(true);
    expect(result.reply).toContain('nothing to add');
  });
});
