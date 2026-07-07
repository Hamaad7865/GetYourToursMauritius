import { describe, expect, it } from 'vitest';
import { cheapestTier, defaultOptionId, optionCardSummary, privateConfig } from '@/lib/catalogue/options';
import type { TourOption } from '@/lib/validation/tours';

const half: TourOption = {
  id: 'a',
  name: 'Half-Day Boat Trip',
  description: null,
  prices: [{ id: 'a1', label: 'Adult', amountEur: 180, maxGuests: null }],
};
const full: TourOption = {
  id: 'b',
  name: 'Full Day Boat Trip',
  description: null,
  prices: [{ id: 'b1', label: 'Adult', amountEur: 360, maxGuests: null }],
};
const tiered: TourOption = {
  id: 'c',
  name: 'Shared',
  description: null,
  prices: [
    { id: 'c1', label: 'Child', amountEur: 40, maxGuests: 8 },
    { id: 'c2', label: 'Adult', amountEur: 60, maxGuests: 8 },
  ],
};

describe('cheapestTier', () => {
  it('returns the lowest-priced tier', () => {
    expect(cheapestTier(tiered)?.amountEur).toBe(40);
    expect(cheapestTier(tiered)?.label).toBe('Child');
  });
  it('returns null when an option has no tiers', () => {
    expect(cheapestTier({ id: 'x', name: 'X', description: null, prices: [] })).toBeNull();
  });
});

describe('defaultOptionId', () => {
  it('picks options[0] for vehicle mode', () => {
    expect(defaultOptionId([full, half], true)).toBe('b');
  });
  it('picks the option holding the globally cheapest tier otherwise', () => {
    expect(defaultOptionId([full, half], false)).toBe('a');
  });
  it('returns null for no options', () => {
    expect(defaultOptionId([], false)).toBeNull();
  });
});

describe('optionCardSummary', () => {
  it('per_person: from-price = cheapest tier', () => {
    const s = optionCardSummary(full, 'per_person', 'activity');
    expect(s.fromPriceEur).toBe(360);
    expect(s.name).toBe('Full Day Boat Trip');
  });
  it('per_group: surfaces maxGuests', () => {
    expect(optionCardSummary(tiered, 'per_group', 'activity').maxGuests).toBe(8);
  });
});

describe('private option helpers', () => {
  const priv: TourOption = {
    id: 'p',
    name: 'Private charter',
    description: null,
    privateBaseEur: 90,
    privateIncluded: 4,
    privateExtraEur: 25,
    privateMaxGuests: 8,
    prices: [],
  };

  it('privateConfig reads the option config; null for a normal option', () => {
    expect(privateConfig(priv)).toEqual({ baseEur: 90, included: 4, extraEur: 25, maxGuests: 8 });
    expect(privateConfig(tiered)).toBeNull();
  });

  it('privateConfig degrades to null on a partial payload (never half-prices)', () => {
    expect(privateConfig({ ...priv, privateMaxGuests: null })).toBeNull();
  });

  it('optionCardSummary: base as from-price, max group, per-private-trip unit', () => {
    const s = optionCardSummary(priv, 'per_person', 'activity');
    expect(s).toEqual({
      name: 'Private charter',
      fromPriceEur: 90,
      maxGuests: 8,
      unitNote: 'per private trip',
      isPrivate: true,
    });
    expect(optionCardSummary(tiered, 'per_person', 'activity').isPrivate).toBe(false);
  });

  it('defaultOptionId still prefers the standard option (a private option has no tiers)', () => {
    expect(defaultOptionId([priv, tiered], false)).toBe('c');
  });
});
