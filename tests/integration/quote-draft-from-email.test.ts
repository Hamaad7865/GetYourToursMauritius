process.env.TZ = 'UTC';

import { describe, expect, it } from 'vitest';
import { draftFromExtraction, type DraftDeps } from '@/lib/services/quote-draft';
import { quoteInputFromForm, type QuoteFormValues } from '@/components/admin/quotes/state';
import { REGION_DISTANCE_DEFAULT, TRANSPORT_BANDS_DEFAULT } from '@/lib/services/pricing';
import type { QuoteDeparture } from '@/lib/admin/quote-catalogue';
import type { QuoteExtraction } from '@/lib/validation/quote-extraction';

/**
 * The whole AI email → draft path (plan Task A2), from a structured extraction to a `QuoteFormValues`
 * the operator reviews. Uses the plan's French fixture: 2 people, 1–9 Sept, four excursions, an
 * automatic car for a day, "one rest day between excursions", pickup at Crystals Beach Resort.
 *
 * The candidate lists and the departure loader are injected, so this is deterministic and touches no
 * database. What it PINS is the guardrail: a matched catalogue tour with an open occurrence is priced
 * from the real tier (never a number the AI supplied — the extraction has no price field at all), and
 * every vehicle/private tour becomes a CUSTOM, UNPRICED line the operator prices by hand.
 */

const CANDIDATES = {
  activities: [
    { id: 'act-south', slug: 'private-south-tour', title: 'Private South Tour' },
    {
      id: 'act-dolphin',
      slug: 'dolphin-swim-benitiers',
      title: 'Dolphin Swim & Île aux Bénitiers',
    },
    { id: 'act-cerfs', slug: 'catamaran-ile-aux-cerfs', title: 'Catamaran to Île aux Cerfs' },
    { id: 'act-north', slug: 'catamaran-north-islands', title: 'Catamaran 3 Northern Islands' },
  ],
  rentals: [{ slug: 'economy-auto', name: 'Economy Automatic', dailyRateEur: 45 }],
};

const VEHICLE_REFUSAL =
  'A vehicle-priced tour cannot be quoted as a tour line yet — quote it as a custom line.';
const PRIVATE_REFUSAL = 'A private option cannot be quoted as a tour line yet.';

/** Scripted departures: only the dolphin swim is a real, priceable catalogue departure on its day. */
const departuresFor: Record<string, Record<string, QuoteDeparture[]>> = {
  'act-dolphin': {
    '2026-09-03': [
      {
        occurrenceId: 'occ-dolphin',
        activityOptionId: 'opt-dolphin',
        optionName: 'Shared boat',
        startsAt: '2026-09-03T05:00:00.000Z',
        tiers: [{ label: 'Adult', amountMinor: 8500 }],
        refusal: null,
      },
    ],
  },
  'act-south': {
    '2026-09-01': [
      {
        occurrenceId: 'occ-south',
        activityOptionId: 'opt-south',
        optionName: 'Private',
        startsAt: '2026-09-01T05:00:00.000Z',
        tiers: [],
        refusal: PRIVATE_REFUSAL,
      },
    ],
  },
  'act-cerfs': {
    '2026-09-05': [
      {
        occurrenceId: 'occ-cerfs',
        activityOptionId: 'opt-cerfs',
        optionName: 'Catamaran',
        startsAt: '2026-09-05T05:00:00.000Z',
        tiers: [],
        refusal: VEHICLE_REFUSAL,
      },
    ],
  },
  'act-north': {
    '2026-09-07': [
      {
        occurrenceId: 'occ-north',
        activityOptionId: 'opt-north',
        optionName: 'Catamaran',
        startsAt: '2026-09-07T05:00:00.000Z',
        tiers: [],
        refusal: VEHICLE_REFUSAL,
      },
    ],
  },
};

const deps: DraftDeps = {
  today: '2026-08-07',
  loadCandidates: async () => CANDIDATES,
  loadDepartures: async (activityId, day) => departuresFor[activityId]?.[day] ?? [],
};

const EXTRACTION: QuoteExtraction = {
  customer: { name: 'Jean Martin', email: 'jean.martin@example.fr' },
  party: { adults: 2 },
  availability: { from: '2026-09-01', to: '2026-09-09' },
  pickupHotel: 'Crystals Beach Resort Belle Mare',
  locale: 'fr',
  activities: [
    { rawText: 'tour privé du sud', matchedSlug: 'private-south-tour', confidence: 'high' },
    { rawText: 'dauphins + Bénitiers', matchedSlug: 'dolphin-swim-benitiers', confidence: 'high' },
    {
      rawText: 'catamaran Île aux Cerfs',
      matchedSlug: 'catamaran-ile-aux-cerfs',
      confidence: 'high',
    },
    { rawText: '3 îles du nord', matchedSlug: 'catamaran-north-islands', confidence: 'low' },
  ],
  rental: { requested: true, matchedSlug: 'economy-auto', days: 1, transmission: 'automatic' },
  preferences: 'un jour de repos entre les excursions',
};

describe('draftFromExtraction — the French sample email', () => {
  it('builds a reviewable draft: 4 excursions + a rental, priced only from the catalogue', async () => {
    const form = await draftFromExtraction(EXTRACTION, deps);

    // Guest header + locale carried straight through.
    expect(form.customerName).toBe('Jean Martin');
    expect(form.customerEmail).toBe('jean.martin@example.fr');
    expect(form.locale).toBe('fr');

    // Pickup hotel + preferences land in the intro note (no structured field exists for either).
    expect(form.introNote).toContain('Crystals Beach Resort Belle Mare');
    expect(form.introNote).toContain('repos');

    // Four excursion lines + one rental line.
    expect(form.lines).toHaveLength(5);

    const rental = form.lines.filter((l) => l.kind === 'rental');
    const catalogue = form.lines.filter((l) => l.kind === 'catalogue');
    const custom = form.lines.filter((l) => l.kind === 'custom');
    expect(rental).toHaveLength(1);
    expect(catalogue).toHaveLength(1); // only the dolphin swim had an open, priceable occurrence
    expect(custom).toHaveLength(3); // private south tour + both vehicle-priced catamarans
  });

  it('prices the catalogue line from the REAL tier and never from the AI (party = 2)', async () => {
    const form = await draftFromExtraction(EXTRACTION, deps);
    const dolphin = form.lines.find((l) => l.kind === 'catalogue')!;

    expect(dolphin.description).toContain('Dolphin Swim');
    expect(dolphin.quantityText).toBe('2'); // party of 2 adults on the Adult tier
    expect(dolphin.unitText).toBe('85.00'); // 8500 minor, straight from the tier
    expect(dolphin.catalogueUnitMinor).toBe(8500);
    expect(dolphin.sessionOccurrenceId).toBe('occ-dolphin');
    expect(dolphin.activityOptionId).toBe('opt-dolphin');
    expect(dolphin.startsAt).toBe('2026-09-03T05:00:00.000Z');

    // It survives quoteInputFromForm as a CATALOGUE line at the catalogue's own price — the money path
    // re-prices catalogue lines and demotes any that don't match, so this proves no AI price rode in.
    const single: QuoteFormValues = { ...form, lines: [dolphin] };
    const [item] = quoteInputFromForm(single).items;
    expect(item?.kind).toBe('catalogue');
    expect(item?.unitAmountMinor).toBe(8500);
    expect(item?.quantity).toBe(2);
  });

  it('leaves every vehicle/private tour as a CUSTOM, UNPRICED line for the operator', async () => {
    const form = await draftFromExtraction(EXTRACTION, deps);
    const custom = form.lines.filter((l) => l.kind === 'custom');

    expect(custom.map((l) => l.description)).toEqual([
      'Private South Tour',
      'Catamaran to Île aux Cerfs',
      'Catamaran 3 Northern Islands',
    ]);
    for (const line of custom) {
      expect(line.unitText).toBe(''); // no price — the operator prices these
      expect(line.catalogueUnitMinor).toBeNull();
      expect(line.rentalVehicleSlug).toBeNull();
      expect(line.quantityText).toBe('2'); // party of 2 shown on each line
    }
    // The scheduled rest-day spacing reaches the custom lines' dates (day 1 / day 5 / day 7).
    expect(custom.map((l) => l.date)).toEqual(['2026-09-01', '2026-09-05', '2026-09-07']);
  });

  it('adds the rental as its own line, priced from the real daily rate × days', async () => {
    const form = await draftFromExtraction(EXTRACTION, deps);
    const rental = form.lines.find((l) => l.kind === 'rental')!;

    expect(rental.rentalVehicleSlug).toBe('economy-auto');
    expect(rental.description).toContain('Economy Automatic');
    expect(rental.quantityText).toBe('1'); // one day, NOT the party size
    expect(rental.unitText).toBe('45.00');

    // A rental line is fully priced and survives the money path with its slug intact.
    const single: QuoteFormValues = { ...form, lines: [rental] };
    const [item] = quoteInputFromForm(single).items;
    expect(item?.kind).toBe('rental');
    expect(item?.rentalVehicleSlug).toBe('economy-auto');
    expect(item?.unitAmountMinor).toBe(4500);
  });

  it('turns an unmatched request into a custom line rather than dropping it', async () => {
    const extraction: QuoteExtraction = {
      ...EXTRACTION,
      activities: [{ rawText: 'a mystery boat trip', matchedSlug: null, confidence: 'low' }],
      rental: { requested: false, matchedSlug: null },
    };
    const form = await draftFromExtraction(extraction, deps);
    expect(form.lines).toHaveLength(1);
    expect(form.lines[0]!.kind).toBe('custom');
    expect(form.lines[0]!.description).toBe('a mystery boat trip');
    expect(form.lines[0]!.unitText).toBe('');
  });
});

/**
 * The transport add-on in the AI draft (Phase 2). When the enquiry names a pickup hotel and the route
 * resolves it to a region, each PER-PERSON / PER-GROUP excursion gets a round-trip transfer priced by
 * the same region-distance engine the booking widget uses — never the AI, which still has no price
 * field. Vehicle-priced tours (whose fare already covers the drive) get none. Opt-in: no pickup region
 * means no transfers, so the existing behaviour above is unchanged.
 */
describe('draftFromExtraction — transport add-on from a resolved pickup', () => {
  const CANDIDATES_WITH_REGION = {
    activities: [
      {
        id: 'act-dolphin',
        slug: 'dolphin-swim-benitiers',
        title: 'Dolphin Swim & Île aux Bénitiers',
        region: 'West',
        pricingMode: 'per_person',
      },
      {
        id: 'act-cerfs',
        slug: 'catamaran-ile-aux-cerfs',
        title: 'Catamaran to Île aux Cerfs',
        region: 'East',
        pricingMode: 'vehicle',
      },
    ],
    rentals: [],
  };

  // Belle Mare is East; the draft was handed the region the route resolved from the hotel text.
  const transportDeps: DraftDeps = {
    today: '2026-08-07',
    loadCandidates: async () => CANDIDATES_WITH_REGION,
    loadDepartures: async (activityId, day) => departuresFor[activityId]?.[day] ?? [],
    pickupRegion: 'East',
    loadTransportPricing: async () => ({
      bands: TRANSPORT_BANDS_DEFAULT,
      distances: REGION_DISTANCE_DEFAULT,
    }),
  };

  const TRANSPORT_EXTRACTION: QuoteExtraction = {
    ...EXTRACTION,
    activities: [
      { rawText: 'dauphins', matchedSlug: 'dolphin-swim-benitiers', confidence: 'high' },
      { rawText: 'catamaran cerfs', matchedSlug: 'catamaran-ile-aux-cerfs', confidence: 'high' },
    ],
    rental: { requested: false, matchedSlug: null },
  };

  it('auto-adds a priced round-trip transfer for a per-person excursion from the pickup', async () => {
    const form = await draftFromExtraction(TRANSPORT_EXTRACTION, transportDeps);
    const transfers = form.lines.filter((l) => /round-trip transfer/i.test(l.description));
    // Only the per-person dolphin swim gets one. Belle Mare (East) → Bénitiers (West) is "far", so a
    // party of 2 is the sedan bracket: TRANSPORT_BANDS_DEFAULT.far.sedanMinor = 5000 = €50.
    expect(transfers).toHaveLength(1);
    const transfer = transfers[0]!;
    expect(transfer.kind).toBe('custom');
    expect(transfer.unitText).toBe('50.00');
    expect(transfer.quantityText).toBe('1'); // one flat fare for the party, not per person
    expect(transfer.description).toContain('Dolphin Swim');
    expect(transfer.description).toContain('Crystals Beach Resort Belle Mare');
  });

  it('never adds a transfer to a vehicle-priced tour (its fare already covers the drive)', async () => {
    const form = await draftFromExtraction(TRANSPORT_EXTRACTION, transportDeps);
    const cerfsTransfer = form.lines.find(
      (l) => /round-trip transfer/i.test(l.description) && /Cerfs/.test(l.description),
    );
    expect(cerfsTransfer).toBeUndefined();
  });

  it('adds no transfers when the pickup could not be resolved to a region', async () => {
    const form = await draftFromExtraction(TRANSPORT_EXTRACTION, {
      ...transportDeps,
      pickupRegion: null,
    });
    expect(form.lines.some((l) => /round-trip transfer/i.test(l.description))).toBe(false);
  });
});
