import { describe, expect, it } from 'vitest';
import {
  activityMetaDescription,
  activityMetaTitle,
  activityPriceLine,
} from '@/lib/seo/activity-meta';
import { SNIPPET_MAX } from '@/lib/seo/snippet';

const base = {
  slug: 'some-tour',
  title: 'Some Tour',
  summary: 'A full day out on the lagoon with snorkelling and lunch on board.',
  description: null,
  seoTitle: null,
  seoDescription: null,
  fromPriceEur: 55,
  fromPriceMaxGuests: null,
  pricingMode: 'per_person' as const,
  pickupAvailable: true,
  isAirportTransfer: false,
};

describe('activityMetaTitle', () => {
  it('lets an /admin search title win over everything', () => {
    const t = { ...base, slug: 'catamaran-sunset-cruise', seoTitle: 'Owner title' };
    expect(activityMetaTitle(t)).toBe('Owner title');
    expect(activityMetaTitle(t, 'fr')).toBe('Owner title');
  });

  it('uses the hand-written title in the page language', () => {
    const t = { ...base, slug: 'catamaran-sunset-cruise', title: 'Catamaran Sunset Cruise' };
    expect(activityMetaTitle(t)).toBe(
      'Sunset Cruise Mauritius: Catamaran in Grand Baie | Belle Mare Tours',
    );
    expect(activityMetaTitle(t, 'fr')).toBe(
      'Croisière coucher de soleil, île Maurice | Belle Mare Tours',
    );
  });

  it('falls back to the tour name when a language has no hand-written title', () => {
    // The French 5-islands title already wins clicks, so only English is hand-written.
    const t = {
      ...base,
      slug: 'the-blue-cruise-ile-aux-cerfs-5-islands-visit',
      title: 'Tour d’une journée complète aux 5 îles – Île aux Cerfs avec déjeuner',
    };
    expect(activityMetaTitle(t, 'fr')).toBe(
      'Tour d’une journée complète aux 5 îles – Île aux Cerfs avec déjeuner | Belle Mare Tours',
    );
  });

  it('cleans the name and adds the place only when it is missing and fits', () => {
    expect(activityMetaTitle({ ...base, title: 'Casela  World of Adventures' })).toBe(
      'Casela World of Adventures, Mauritius | Belle Mare Tours',
    );
    expect(activityMetaTitle({ ...base, title: 'Private North Tour Mauritius' })).toBe(
      'Private North Tour Mauritius | Belle Mare Tours',
    );
    const long = 'Full Day 3 Northern Island Speed Boat with Lunch(BBQ)';
    expect(activityMetaTitle({ ...base, title: long })).toBe(`${long} | Belle Mare Tours`);
  });

  it('keeps every hand-written title short enough that the searched phrase is never cut', () => {
    const slugs = [
      'the-blue-cruise-ile-aux-cerfs-5-islands-visit',
      'underwater-sea-walk-excursion',
      'catamaran-sunset-cruise',
      'catamaran-cruise-ile-aux-cerfs',
      'blue-safari-submarine-subscooter',
      'skydive',
      'casela-world-of-adventures',
      'helicotour',
    ];
    for (const slug of slugs)
      for (const locale of ['en', 'fr'] as const) {
        const visible = activityMetaTitle({ ...base, slug, title: 'X' }, locale).replace(
          / \| Belle Mare Tours$/,
          '',
        );
        expect(visible.length, `${slug} ${locale}`).toBeLessThanOrEqual(50);
      }
  });
});

describe('activityMetaDescription', () => {
  it('lets an /admin description win', () => {
    expect(activityMetaDescription({ ...base, seoDescription: 'Owner copy' })).toBe('Owner copy');
  });

  it('adds the from-price, unit and pickup within the snippet budget', () => {
    const d = activityMetaDescription(base);
    expect(d).toContain('From €55 per person. Hotel pickup available.');
    expect(d.length).toBeLessThanOrEqual(SNIPPET_MAX);
    const fr = activityMetaDescription(base, 'fr');
    expect(fr).toContain('À partir de 55 € par personne. Prise en charge à l’hôtel possible.');
  });

  it('keeps the price when the summary is one long sentence', () => {
    // The 5-islands summary: 180 characters, one sentence. The price used to be the part dropped.
    const summary =
      "A full-day speedboat excursion from Trou d'Eau Douce taking in the GRSE waterfall, snorkeling among coral gardens, five islands, a BBQ lunch and the beaches of northern Île aux Cerfs.";
    const d = activityMetaDescription({ ...base, summary, fromPriceEur: 80 });
    expect(d.startsWith('From €80 per person. Hotel pickup available. A full-day speedboat')).toBe(
      true,
    );
    expect(d.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(d).not.toMatch(/\S…\S/); // never cut mid-word
  });

  it('never quotes €0, a transfer fare, or a price whose unit is unclear', () => {
    expect(activityPriceLine({ ...base, fromPriceEur: 0 })).toBe('Hotel pickup available.');
    expect(activityPriceLine({ ...base, fromPriceEur: null })).toBe('Hotel pickup available.');
    expect(activityPriceLine({ ...base, isAirportTransfer: true, pickupAvailable: false })).toBe(
      '',
    );
    // A per-group price with no group size would read as per person.
    expect(activityPriceLine({ ...base, pricingMode: 'per_group', pickupAvailable: false })).toBe(
      '',
    );
  });

  it('words vehicle and group prices the way the card does', () => {
    expect(activityPriceLine({ ...base, pricingMode: 'vehicle', fromPriceEur: 70 })).toBe(
      'From €70 per vehicle. Hotel pickup available.',
    );
    expect(
      activityPriceLine({
        ...base,
        pricingMode: 'per_group',
        fromPriceEur: 750,
        fromPriceMaxGuests: 4,
        pickupAvailable: false,
      }),
    ).toBe('From €750 per group of up to 4.');
    expect(activityPriceLine({ ...base, fromPriceEur: 32.5, pickupAvailable: false }, 'fr')).toBe(
      'À partir de 32,50 € par personne.',
    );
  });

  it('keeps the summary alone when there is nothing to add', () => {
    expect(activityMetaDescription({ ...base, fromPriceEur: null, pickupAvailable: false })).toBe(
      base.summary,
    );
  });
});
