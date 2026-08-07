import { z } from 'zod';

/**
 * What the AI must return when it reads a customer enquiry email (plan Task A1).
 *
 * This is the forced-JSON contract handed to `generateObject`: the model fills exactly these fields
 * and nothing else. Two things are deliberate and load-bearing:
 *
 *  1. **There is no price anywhere in this shape.** The guardrail that "the AI never sets a price that
 *     becomes a charge" begins here — a model with no slot for a price cannot smuggle one into the
 *     draft. It proposes a catalogue `matchedSlug`; the draft builder prices that slug from the real
 *     catalogue (`activity_option_prices`), never from anything the model said.
 *  2. **A match is a slug or an explicit `null`.** `matchedSlug` is chosen from the candidate list the
 *     service feeds the model; `null` means "unsure", which the draft builder turns into a custom line
 *     the operator prices by hand rather than a guessed catalogue charge.
 *
 * Dates are ISO `yyyy-mm-dd` calendar days (a stay RANGE, `from`..`to`). Money never appears; party is
 * counts, not prices; `pickupHotel` and `preferences` are free text that flow into the draft's intro
 * note, since the quote has no structured field for either.
 */

/** How sure the model is that `matchedSlug` is the right catalogue tour. Low-confidence matches are
 *  surfaced to the operator for review rather than trusted silently. */
export const matchConfidenceSchema = z.enum(['high', 'low']);
export type MatchConfidence = z.infer<typeof matchConfidenceSchema>;

export const extractedActivitySchema = z.object({
  /** The words the customer used for this request, kept verbatim so the operator can see the source. */
  rawText: z.string(),
  /** A slug from the candidate list, or null when the model is not sure enough to match. */
  matchedSlug: z.string().nullable(),
  confidence: matchConfidenceSchema,
});
export type ExtractedActivity = z.infer<typeof extractedActivitySchema>;

export const extractedRentalSchema = z.object({
  /** Did the customer ask for a rental at all. */
  requested: z.boolean(),
  /** A rental-fleet slug from the candidate list, or null when unmatched/not requested. */
  matchedSlug: z.string().nullable(),
  /** Rental duration in whole days, when the customer stated one. */
  days: z.number().int().positive().nullable().optional(),
  transmission: z.enum(['automatic', 'manual']).nullable().optional(),
});
export type ExtractedRental = z.infer<typeof extractedRentalSchema>;

export const quoteExtractionSchema = z.object({
  customer: z.object({
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  }),
  /** Party head-counts. `adults` is always present (default a solo traveller if the email is vague);
   *  `children`/`infants` only when stated. */
  party: z.object({
    adults: z.number().int().nonnegative(),
    children: z.number().int().nonnegative().optional(),
    infants: z.number().int().nonnegative().optional(),
  }),
  /** The stay window as ISO `yyyy-mm-dd` dates. Either end may be missing if the email is vague. */
  availability: z.object({
    from: z.string().nullable().optional(),
    to: z.string().nullable().optional(),
  }),
  /** Free-text pickup hotel/location. No structured quote field exists — it flows into the intro note. */
  pickupHotel: z.string().nullable().optional(),
  /** The language the OFFER should be written in (the quote's own locale), inferred from the email. */
  locale: z.enum(['en', 'fr']),
  activities: z.array(extractedActivitySchema),
  rental: extractedRentalSchema,
  /** Any other request that shapes scheduling or the offer, e.g. "one rest day between excursions". */
  preferences: z.string().nullable().optional(),
});
export type QuoteExtraction = z.infer<typeof quoteExtractionSchema>;
