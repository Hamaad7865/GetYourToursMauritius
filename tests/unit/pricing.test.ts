import { describe, expect, it } from 'vitest';
import { centsToEur, eurToCents, quoteTotal, sightseeingQuote } from '@/lib/services/pricing';
import { ServiceError } from '@/lib/services/errors';

const TIERS = [
  { label: 'Adult', amountEur: 75, maxGuests: null },
  { label: 'Child', amountEur: 45, maxGuests: null },
  { label: 'Private group', amountEur: 110, maxGuests: 6 },
];

const SIGHTSEEING = { perBlockEur: 70, suvFlatEur: 85, blockSize: 4, maxParty: 25 };

describe('sightseeingQuote', () => {
  it('charges €70 per block of 4, named by party size', () => {
    const cases: Array<[number, string, number]> = [
      [1, 'Sedan', 70],
      [4, 'Sedan', 70],
      [5, 'Family car', 140],
      [6, 'Family car', 140],
      [7, 'Minibus', 140],
      [8, 'Minibus', 140],
      [9, 'Minibus', 210],
      [12, 'Minibus', 210],
      [13, 'Minibus', 280],
      [14, 'Minibus', 280],
      [15, 'Coaster', 280],
      [20, 'Coaster', 350],
      [24, 'Coaster', 420],
      [25, 'Coaster', 490],
    ];
    for (const [people, vehicle, total] of cases) {
      const q = sightseeingQuote(people, false, SIGHTSEEING);
      expect(q.vehicle).toBe(vehicle);
      expect(q.totalEur).toBe(total);
    }
  });

  it('applies the flat €85 SUV upgrade only for parties of 1–4', () => {
    expect(sightseeingQuote(2, true, SIGHTSEEING)).toEqual({ vehicle: 'SUV', totalEur: 85 });
    expect(sightseeingQuote(4, true, SIGHTSEEING)).toEqual({ vehicle: 'SUV', totalEur: 85 });
    expect(sightseeingQuote(5, true, SIGHTSEEING)).toEqual({ vehicle: 'Family car', totalEur: 140 });
  });

  it('throws above the cap and below 1', () => {
    expect(() => sightseeingQuote(26, false, SIGHTSEEING)).toThrow(ServiceError);
    expect(() => sightseeingQuote(0, false, SIGHTSEEING)).toThrow(ServiceError);
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
