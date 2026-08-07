import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import type { LanguageModelV1 } from 'ai';
import { extractQuoteFromEmail } from '@/lib/services/quote-extraction';
import { quoteExtractionSchema, type QuoteExtraction } from '@/lib/validation/quote-extraction';
import type { ServiceContext } from '@/lib/services/context';

/**
 * The AI email → structured extraction step (plan Task A1), scripted end-to-end without Gemini: the
 * model is a `MockLanguageModelV1` that returns a fixed JSON object, and the candidate-list fetches
 * (published activities, rental fleet) are mocked so the test never touches a DB. This proves the
 * CONTRACT that must hold when the real model runs — the result is exactly the Zod-validated shape,
 * and with no model configured the feature reports itself unavailable rather than throwing.
 *
 * The extraction schema carries NO price field anywhere: the guardrail that "the AI never sets a
 * price" starts here, in a shape that gives a model no slot to put one in.
 */

// The candidate lists only feed the prompt; a scripted model ignores the prompt, so empty lists are
// enough to keep the service off the database in this unit test.
vi.mock('@/lib/services/activities', () => ({
  searchActivities: vi.fn(async () => ({ items: [], total: 0 })),
}));
vi.mock('@/lib/services/rental', () => ({
  listRentalVehicles: vi.fn(async () => []),
}));

const ctx = { locale: 'en' } as unknown as ServiceContext;

/** The French enquiry the plan uses as its fixture, as the model is scripted to return it. */
const FRENCH_EMAIL = `Bonjour,
Nous sommes 2 personnes et séjournons au Crystals Beach Resort Belle Mare du 1 au 9 septembre 2026.
Nous aimerions: un tour privé du sud, nager avec les dauphins + Île aux Bénitiers + déjeuner, une
croisière en catamaran à l'Île aux Cerfs, et une croisière catamaran vers les 3 îles du nord. Nous
voulons aussi louer une voiture automatique pour 1 jour. Merci de laisser un jour de repos entre les
excursions.
Jean Martin — jean.martin@example.fr`;

const EXPECTED: QuoteExtraction = {
  customer: { name: 'Jean Martin', email: 'jean.martin@example.fr' },
  party: { adults: 2 },
  availability: { from: '2026-09-01', to: '2026-09-09' },
  pickupHotel: 'Crystals Beach Resort Belle Mare',
  locale: 'fr',
  activities: [
    { rawText: 'tour privé du sud', matchedSlug: 'private-south-tour', confidence: 'high' },
    {
      rawText: 'nager avec les dauphins + Île aux Bénitiers + déjeuner',
      matchedSlug: 'dolphin-swim-benitiers',
      confidence: 'high',
    },
    {
      rawText: "croisière catamaran à l'Île aux Cerfs",
      matchedSlug: 'catamaran-ile-aux-cerfs',
      confidence: 'high',
    },
    {
      rawText: 'croisière catamaran 3 îles du nord',
      matchedSlug: 'catamaran-north-islands',
      confidence: 'low',
    },
  ],
  rental: { requested: true, matchedSlug: 'economy-auto', days: 1, transmission: 'automatic' },
  preferences: 'un jour de repos entre les excursions',
};

/** A model that answers `generateObject` with a fixed JSON object (json object-generation mode). */
function scriptedObjectModel(object: unknown): LanguageModelV1 {
  return new MockLanguageModelV1({
    defaultObjectGenerationMode: 'json',
    doGenerate: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      finishReason: 'stop' as const,
      usage: { promptTokens: 1, completionTokens: 1 },
      text: JSON.stringify(object),
    }),
  });
}

describe('extractQuoteFromEmail', () => {
  it('returns the Zod-validated structured extraction from a scripted model', async () => {
    const result = await extractQuoteFromEmail(ctx, FRENCH_EMAIL, scriptedObjectModel(EXPECTED));

    expect(result.available).toBe(true);
    expect(result.extraction).toEqual(EXPECTED);
    // The whole thing must satisfy the published schema (no stray fields, right shape).
    expect(quoteExtractionSchema.safeParse(result.extraction).success).toBe(true);
    // The guardrail's first line: nowhere in the shape is there a price the model could have set.
    expect(JSON.stringify(result.extraction)).not.toMatch(/price|amount|eur|minor/i);
    expect(result.extraction?.party.adults).toBe(2);
    expect(result.extraction?.activities).toHaveLength(4);
    expect(result.extraction?.rental.matchedSlug).toBe('economy-auto');
  });

  it('reports { available: false } when no model is configured (Gemini billing blocker)', async () => {
    const stubCtx = { locale: 'en', ai: { name: 'stub', model: '' } } as unknown as ServiceContext;
    const result = await extractQuoteFromEmail(stubCtx, FRENCH_EMAIL, null);
    expect(result.available).toBe(false);
    expect(result.extraction).toBeNull();
  });

  it('coerces a matched slug of null through the schema (model unsure)', async () => {
    const unsure: QuoteExtraction = {
      ...EXPECTED,
      activities: [{ rawText: 'a boat thing', matchedSlug: null, confidence: 'low' }],
      rental: { requested: false, matchedSlug: null },
    };
    const result = await extractQuoteFromEmail(ctx, FRENCH_EMAIL, scriptedObjectModel(unsure));
    expect(result.extraction?.activities[0]?.matchedSlug).toBeNull();
    expect(result.extraction?.rental.requested).toBe(false);
  });
});
