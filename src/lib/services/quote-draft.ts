import {
  loadActivityDepartures,
  loadTransportPricing,
  type QuoteDeparture,
} from '@/lib/admin/quote-catalogue';
import { proposeSchedule } from '@/lib/quotes/schedule';
import {
  customLineDraft,
  emptyQuoteForm,
  formatMinorAsEuros,
  tourLineDrafts,
  transportLineDraft,
  type QuoteFormValues,
  type QuoteLineDraft,
  type TourPick,
} from '@/components/admin/quotes/state';
import {
  transportFareMinor,
  type RegionDistanceMap,
  type TransportBandPricing,
} from '@/lib/services/pricing';
import type { QuoteExtraction } from '@/lib/validation/quote-extraction';

/**
 * Turn a structured extraction (plan Task A1) into a draft `QuoteFormValues` the operator reviews and
 * sends (plan Task A2). This is where the guardrails become code:
 *
 *  - **A matched catalogue tour is priced from the catalogue, or not at all.** For each request the
 *    model matched to a real slug, this resolves the slug to its activity, picks a day from the
 *    rest-day schedule, and asks `loadActivityDepartures` for a real open occurrence. If one exists AND
 *    its shape can be a tour line (`refusal === null` — not a private option, not a vehicle-priced
 *    tour, not a tier-less option), the line is built at the REAL tier amount via `tourLineDrafts`.
 *    Otherwise it falls back to a CUSTOM line with NO price — the operator prices it. Most sightseeing
 *    tours (private tours, vehicle-priced catamarans) land in the custom fallback by design.
 *  - **The AI never sets a price.** The extraction carries no price field; the only figures written to
 *    a line come from `activity_option_prices` (catalogue tiers) or the rental fleet's own daily rate.
 *    A custom line is left unpriced on purpose — an empty unit that the editor flags until the operator
 *    fills it, never a silent €0.
 *  - **Nothing is auto-sent.** This returns a form; the operator reviews, prices the custom lines, and
 *    sends.
 *
 * The candidate lists and the departure loader are injectable so the flow is deterministic in tests
 * (mirroring `runPlannerTurn`'s `modelOverride` seam) and so the caller can supply the right data
 * source — the admin editor runs the catalogue reads through the authenticated browser client.
 */

/** One catalogue activity the draft can resolve a matched slug against. */
export interface DraftActivityCandidate {
  id: string;
  slug: string;
  title: string;
  /** The boarding region a transfer is priced against. Optional so older callers / fixtures need not
   *  supply it; the route fills it from searchActivities. Null on an activity with no map location. */
  region?: string | null;
  /** The activity's pricing mode. A transport add-on applies only to `per_person` / `per_group` —
   *  `vehicle` / `vehicle_custom` already price the whole drive. Optional for the same reason. */
  pricingMode?: string;
}

/** One rental vehicle the draft can resolve a matched rental slug against. */
export interface DraftRentalCandidate {
  slug: string;
  name: string;
  /** EUR/day, from the real fleet — the unit price of a rental line. */
  dailyRateEur: number;
}

export interface DraftDeps {
  /** REQUIRED: the catalogue + fleet the draft resolves matched slugs against. Injected rather than
   *  fetched here so this module stays browser-safe (no server-service imports): the draft-from-email
   *  route fetches these server-side and hands them to the browser, which runs the draft; tests inject
   *  a fixture. The browser picker list (loadQuotableActivities) carries no slug, which is why the
   *  server candidate list — searchActivities, which has slug + id — is the source. */
  loadCandidates: () => Promise<{
    activities: DraftActivityCandidate[];
    rentals: DraftRentalCandidate[];
  }>;
  /** Defaults to the browser `loadActivityDepartures`; injected in tests. */
  loadDepartures?: (activityId: string, day: string) => Promise<QuoteDeparture[]>;
  /** The region the ROUTE resolved the pickup hotel to (server-side geocode). When set, each
   *  per-person / per-group excursion gets a round-trip transfer priced from it; null/absent means no
   *  transfers (the pre-transport behaviour). Never derived here — the AI does not decide geography. */
  pickupRegion?: string | null;
  /** The transport-fare config; defaults to the browser `loadTransportPricing`, injected in tests.
   *  Only read when `pickupRegion` is set. */
  loadTransportPricing?: () => Promise<{
    bands: TransportBandPricing;
    distances: RegionDistanceMap;
  }>;
  /** Pins the `valid_until` default in tests. */
  today?: string;
}

/** A transport add-on applies to per-person / per-group excursions only; vehicle-priced tours already
 *  cover the drive in their fare (mirrors the exclusion in 20260720000000_activity_transport_pricing). */
function isTransportEligible(pricingMode: string | undefined): boolean {
  return pricingMode === 'per_person' || pricingMode === 'per_group';
}

/** A "rest day between excursions" request, in English or French, means space tours 2 days apart. */
const REST_DAY_PATTERN = /rest[\s-]?day|day of rest|jour de repos|repos entre|espac/i;

type Party = QuoteExtraction['party'];

function totalGuests(party: Party): number {
  return party.adults + (party.children ?? 0) + (party.infants ?? 0);
}

/** How many of the party a price tier covers, matched on its label (Adult/Child/Infant, EN or FR). A
 *  tier with no age word (a single flat tier for everyone) covers the whole party. */
function tierQuantity(label: string, party: Party): number {
  const l = label.toLowerCase();
  if (/adult|adulte/.test(l)) return party.adults;
  if (/child|enfant/.test(l)) return party.children ?? 0;
  if (/infant|baby|b[ée]b[ée]|nourrisson/.test(l)) return party.infants ?? 0;
  return totalGuests(party);
}

/** Pickup hotel + preferences → the guest-facing intro note (the quote has no structured field for
 *  either). English labels seed a note the operator edits before sending. */
function composeIntroNote(extraction: QuoteExtraction): string {
  const parts: string[] = [];
  const hotel = extraction.pickupHotel?.trim();
  const prefs = extraction.preferences?.trim();
  if (hotel) parts.push(`Pickup: ${hotel}`);
  if (prefs) parts.push(`Preferences: ${prefs}`);
  return parts.join('\n');
}

/** A custom, UNPRICED excursion line — the operator prices it. Carries the intended day so it shows on
 *  the operations calendar (Part 3) and the operator sees which day it was quoted for. */
function customExcursionLine(
  description: string,
  day: string | null,
  guests: number,
): QuoteLineDraft {
  const line = customLineDraft();
  line.description = description;
  line.quantityText = String(Math.max(1, guests));
  line.unitText = '';
  line.date = day ?? '';
  line.time = '';
  return line;
}

/** A rental line priced from the REAL fleet daily rate × days (never the AI). `kind` must be 'rental'
 *  or the money path (`quoteItemRows`) drops the vehicle slug. */
function rentalLine(vehicle: DraftRentalCandidate, days: number): QuoteLineDraft {
  const line = customLineDraft();
  const d = Math.max(1, Math.floor(days));
  line.kind = 'rental';
  line.rentalVehicleSlug = vehicle.slug;
  line.description = `${vehicle.name} — car rental, ${d} day${d === 1 ? '' : 's'}`;
  line.quantityText = String(d);
  line.unitText = formatMinorAsEuros(Math.round(vehicle.dailyRateEur * 100));
  return line;
}

export async function draftFromExtraction(
  extraction: QuoteExtraction,
  deps: DraftDeps,
): Promise<QuoteFormValues> {
  const loadDepartures = deps.loadDepartures ?? loadActivityDepartures;

  const form = emptyQuoteForm(deps.today);
  form.customerName = (extraction.customer.name ?? '').trim();
  form.customerEmail = (extraction.customer.email ?? '').trim();
  form.locale = extraction.locale;
  form.introNote = composeIntroNote(extraction);

  const { activities, rentals } = await deps.loadCandidates();
  const bySlug = new Map(activities.map((a) => [a.slug, a] as const));

  const party = extraction.party;
  const guests = totalGuests(party);
  const gap = REST_DAY_PATTERN.test(extraction.preferences ?? '') ? 2 : 1;
  const schedule = proposeSchedule(
    extraction.availability.from,
    extraction.availability.to,
    extraction.activities.length,
    gap,
  );

  // The transport add-on config, loaded once, ONLY when the route resolved the pickup to a region.
  const pickupRegion = deps.pickupRegion ?? null;
  const transport = pickupRegion
    ? await (deps.loadTransportPricing ?? loadTransportPricing)()
    : null;
  const pickupLabel = extraction.pickupHotel?.trim() ?? '';

  const lines: QuoteLineDraft[] = [];
  for (let i = 0; i < extraction.activities.length; i += 1) {
    const request = extraction.activities[i]!;
    const day = schedule.dates[i] ?? null;
    const candidate = request.matchedSlug ? (bySlug.get(request.matchedSlug) ?? null) : null;

    // A real catalogue line only when we matched a candidate AND have a day to check it on.
    let priced = false;
    if (candidate && day) {
      const departures = await loadDepartures(candidate.id, day);
      // The first open, quotable departure — one whose shape the money path will accept as a tour line.
      const priceable = departures.find((d) => d.refusal === null);
      if (priceable) {
        const pick: TourPick = {
          activityTitle: candidate.title,
          optionName: priceable.optionName,
          activityOptionId: priceable.activityOptionId,
          sessionOccurrenceId: priceable.occurrenceId,
          startsAt: priceable.startsAt,
          tiers: priceable.tiers.map((t) => ({
            label: t.label,
            amountMinor: t.amountMinor,
            quantity: tierQuantity(t.label, party),
          })),
        };
        const tourLines = tourLineDrafts(pick);
        // Only a real line if some tier applied to this party; otherwise fall through to custom.
        if (tourLines.length > 0) {
          lines.push(...tourLines);
          priced = true;
        }
      }
    }

    // Fallback: an UNPRICED custom line. Vehicle/private tours, a matched tour with no open occurrence
    // on the chosen day, and an unmatched request (so nothing the customer asked for is dropped) all
    // land here for the operator to price.
    if (!priced) {
      lines.push(customExcursionLine(candidate?.title ?? request.rawText, day, guests));
    }

    // Its round-trip transfer, right after the excursion it serves. Priced from the region engine (the
    // same fares the booking widget uses), never the AI — eligibility is the activity's pricing mode,
    // not whether it became a catalogue or custom line, so a per-person tour with no open occurrence
    // still gets its transfer. The fare is 0 (and the operator prices it) when the activity has no
    // region; a vehicle-priced tour gets none at all.
    if (transport && candidate && isTransportEligible(candidate.pricingMode)) {
      lines.push(
        transportLineDraft({
          activityTitle: candidate.title,
          pickupLabel,
          fareMinor: transportFareMinor(
            pickupRegion,
            candidate.region ?? null,
            guests,
            false,
            transport.bands,
            transport.distances,
          ),
          date: day ?? undefined,
        }),
      );
    }
  }

  // The rental becomes its own line, priced from the fleet's real daily rate.
  if (extraction.rental.requested && extraction.rental.matchedSlug) {
    const vehicle = rentals.find((v) => v.slug === extraction.rental.matchedSlug);
    if (vehicle) lines.push(rentalLine(vehicle, extraction.rental.days ?? 1));
  }

  form.lines = lines;
  return form;
}
