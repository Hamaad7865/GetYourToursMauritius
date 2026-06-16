import { describe, expect, it } from 'vitest';
import {
  centsToEur,
  eurToCents,
  maxVehicleCapacity,
  pickVehicleBracket,
  quoteTotal,
} from '@/lib/services/pricing';
import { ServiceError } from '@/lib/services/errors';

const VEHICLE_BRACKETS = [
  { label: 'Car', amountEur: 75, maxGuests: 4 },
  { label: '6-seater', amountEur: 85, maxGuests: 6 },
  { label: 'Van', amountEur: 125, maxGuests: 14 },
  { label: 'Minibus', amountEur: 240, maxGuests: 22 },
];

const TIERS = [
  { label: 'Adult', amountEur: 75, maxGuests: null },
  { label: 'Child', amountEur: 45, maxGuests: null },
  { label: 'Private group', amountEur: 110, maxGuests: 6 },
];

describe('pickVehicleBracket / maxVehicleCapacity', () => {
  it('picks the cheapest vehicle that fits, rounding the party up to the next vehicle', () => {
    const cases: Array<[number, string, number]> = [
      [1, 'Car', 75],
      [4, 'Car', 75],
      [5, '6-seater', 85],
      [6, '6-seater', 85],
      [7, 'Van', 125],
      [14, 'Van', 125],
      [15, 'Minibus', 240],
      [22, 'Minibus', 240],
    ];
    for (const [people, label, amountEur] of cases) {
      const bracket = pickVehicleBracket(VEHICLE_BRACKETS, people);
      expect(bracket.label).toBe(label);
      expect(bracket.amountEur).toBe(amountEur);
    }
  });

  it('throws when the party is bigger than the biggest vehicle', () => {
    expect(() => pickVehicleBracket(VEHICLE_BRACKETS, 23)).toThrow(ServiceError);
  });

  it('reports the largest configured vehicle capacity', () => {
    expect(maxVehicleCapacity(VEHICLE_BRACKETS)).toBe(22);
    expect(maxVehicleCapacity([{ label: 'x', amountEur: 1, maxGuests: null }])).toBe(0);
  });
});

describe('eurToCents / centsToEur', () => {
  it('round-trips whole and fractional amounts', () => {
    expect(eurToCents(75)).toBe(7500);
    expect(eurToCents(33.33)).toBe(3333);
    expect(centsToEur(3333)).toBe(33.33);
  });

  it('rounds to the nearest cent', () => {
    expect(eurToCents(10.25)).toBe(1025);
    expect(eurToCents(10.999)).toBe(1100);
    expect(eurToCents(10.001)).toBe(1000);
  });

  it('rejects negative or non-finite amounts', () => {
    expect(() => eurToCents(-1)).toThrow(ServiceError);
    expect(() => eurToCents(Number.NaN)).toThrow(ServiceError);
    expect(() => eurToCents(Number.POSITIVE_INFINITY)).toThrow(ServiceError);
  });
});

describe('quoteTotal', () => {
  it('computes a multi-tier total with correct line items and guest count', () => {
    const quote = quoteTotal(TIERS, { Adult: 2, Child: 1 });
    expect(quote.totalEur).toBe(195); // 2*75 + 1*45
    expect(quote.totalGuests).toBe(3);
    expect(quote.lines).toEqual([
      { label: 'Adult', unitAmountEur: 75, quantity: 2, subtotalEur: 150 },
      { label: 'Child', unitAmountEur: 45, quantity: 1, subtotalEur: 45 },
    ]);
  });

  it('avoids floating-point drift', () => {
    const quote = quoteTotal([{ label: 'Adult', amountEur: 0.1, maxGuests: null }], { Adult: 3 });
    expect(quote.totalEur).toBe(0.3);
  });

  it('skips zero-quantity tiers but keeps selected ones', () => {
    const quote = quoteTotal(TIERS, { Adult: 1, Child: 0 });
    expect(quote.lines).toHaveLength(1);
    expect(quote.totalEur).toBe(75);
  });

  it('respects a tier max-guests cap', () => {
    expect(() => quoteTotal(TIERS, { 'Private group': 7 })).toThrow(/exceeds the maximum/);
    const ok = quoteTotal(TIERS, { 'Private group': 6 });
    expect(ok.totalEur).toBe(660);
  });

  it('rejects unknown tiers', () => {
    expect(() => quoteTotal(TIERS, { Senior: 1 })).toThrow(/Unknown price tier/);
  });

  it('rejects non-integer and negative quantities', () => {
    expect(() => quoteTotal(TIERS, { Adult: 1.5 })).toThrow(ServiceError);
    expect(() => quoteTotal(TIERS, { Adult: -1 })).toThrow(ServiceError);
  });

  it('rejects an empty or all-zero selection', () => {
    expect(() => quoteTotal(TIERS, {})).toThrow(/at least one guest/i);
    expect(() => quoteTotal(TIERS, { Adult: 0 })).toThrow(/at least one guest/i);
  });

  it('rejects duplicate tier labels', () => {
    const dup = [
      { label: 'Adult', amountEur: 75, maxGuests: null },
      { label: 'Adult', amountEur: 80, maxGuests: null },
    ];
    expect(() => quoteTotal(dup, { Adult: 1 })).toThrow(/Duplicate price tier/);
  });

  it('rejects an empty tier list', () => {
    expect(() => quoteTotal([], { Adult: 1 })).toThrow(/No price tiers/);
  });
});
