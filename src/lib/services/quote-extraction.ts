import { generateObject, type LanguageModelV1 } from 'ai';
import type { ServiceContext } from './context';
import { plannerModel } from './planner-agent';
import { searchActivities } from './activities';
import { listRentalVehicles } from './rental';
import { quoteExtractionSchema, type QuoteExtraction } from '@/lib/validation/quote-extraction';

/**
 * Read a customer enquiry email into the structured extraction the draft builder needs (plan Task A1).
 *
 * This is the first forced-JSON use in the repo — the clean `generateObject({ model, schema, prompt })`
 * path (AI SDK v4) rather than a tool-calling loop, because there is one shape to fill and nothing to
 * act on. The model is built with the same `plannerModel(ctx)` seam the planner uses: real Gemini only
 * when the provider is Google AND a key is set; otherwise null, and the feature reports itself
 * unavailable so the operator fills the quote by hand (the Gemini-billing blocker documented in the
 * plan). Tests inject a scripted `MockLanguageModelV1`.
 *
 * THE GUARDRAIL STARTS HERE. The model is given candidate lists — the published catalogue and the
 * rental fleet — and asked to return at most one candidate `slug` per request, or `null` when unsure.
 * It is never asked for a price, and {@link quoteExtractionSchema} gives it nowhere to put one: the
 * draft builder prices a matched slug from the real catalogue, and everything else becomes a custom
 * line the operator prices. A model that invents a slug produces one the draft builder cannot resolve
 * (it falls back to a custom line); a model cannot invent a price at all.
 */

export interface QuoteExtractionResult {
  /** False when no Gemini model is configured — the caller shows "AI unavailable, fill manually". */
  available: boolean;
  extraction: QuoteExtraction | null;
}

const INSTRUCTIONS = `You read a holiday enquiry email for a Mauritius tour operator and return a structured request.

Rules:
- Match each excursion the customer asks for to AT MOST ONE slug from the ACTIVITY CANDIDATES below, or null if you are not sure. Never invent a slug. Set confidence "high" only when the candidate clearly is the tour they mean; otherwise "low".
- If they ask to rent a car or scooter, set rental.requested true and match a slug from the RENTAL CANDIDATES (or null if none fits). Fill days and transmission only if the email states them.
- NEVER decide or output a price, amount or total. You only identify WHAT they want; the operator prices it.
- party.adults is the number of adults (default 1 if the email implies a solo traveller but gives no number). Add children/infants only when stated.
- availability.from / availability.to are the stay dates as ISO yyyy-mm-dd. Leave a side null if it is not given.
- pickupHotel is the hotel or place they are staying / want picked up from, as free text.
- locale is the language the OFFER should be written in: "fr" if the email is in French, otherwise "en".
- preferences captures any request that shapes scheduling or the offer (e.g. a rest day between excursions), as free text.`;

interface ActivityCandidate {
  slug: string;
  title: string;
  category: string;
  region: string | null;
  pricingMode: string;
}

interface RentalCandidate {
  slug: string;
  name: string;
  category: string;
  transmission: string | null;
}

function buildPrompt(
  emailText: string,
  activities: ActivityCandidate[],
  rentals: RentalCandidate[],
): string {
  const activityLines = activities.length
    ? activities
        .map(
          (a) =>
            `- ${a.slug} | ${a.title} | ${a.category}${a.region ? ` | ${a.region}` : ''} | ${a.pricingMode}`,
        )
        .join('\n')
    : '(none)';
  const rentalLines = rentals.length
    ? rentals
        .map(
          (v) =>
            `- ${v.slug} | ${v.name} | ${v.category}${v.transmission ? ` | ${v.transmission}` : ''}`,
        )
        .join('\n')
    : '(none)';
  return `${INSTRUCTIONS}

ACTIVITY CANDIDATES (slug | title | category | region | pricing):
${activityLines}

RENTAL CANDIDATES (slug | name | category | transmission):
${rentalLines}

EMAIL:
${emailText}`;
}

export async function extractQuoteFromEmail(
  ctx: ServiceContext,
  emailText: string,
  // Injectable so the extraction can be tested with a scripted model; defaults to the real Gemini.
  modelOverride?: LanguageModelV1 | null,
): Promise<QuoteExtractionResult> {
  const model = modelOverride ?? plannerModel(ctx);
  // No model (stub provider / no key) → graceful "unavailable" BEFORE any DB work, so the manual path
  // never pays for a candidate fetch it will not use.
  if (!model) return { available: false, extraction: null };

  const [activityPage, rentals] = await Promise.all([
    // A generous single page: the model matches against real published slugs, so it cannot invent one.
    searchActivities(ctx, { page: 1, pageSize: 100 }),
    listRentalVehicles(ctx),
  ]);

  const prompt = buildPrompt(
    emailText,
    activityPage.items.map((a) => ({
      slug: a.slug,
      title: a.title,
      category: a.category,
      region: a.region ?? null,
      pricingMode: a.pricingMode,
    })),
    rentals.map((v) => ({
      slug: v.slug,
      name: v.name,
      category: v.category,
      transmission: v.transmission,
    })),
  );

  const { object } = await generateObject({ model, schema: quoteExtractionSchema, prompt });
  return { available: true, extraction: object };
}
