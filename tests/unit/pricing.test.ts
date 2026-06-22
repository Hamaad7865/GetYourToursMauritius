import { describe, expect, it } from 'vitest';
import {
  centsToEur,
  eurToCents,
  quoteTotal,
  sightseeingQuote,
  regionDistanceBand,
  transportFareMinor,
  transportFare,
  TRANSPORT_BANDS_DEFAULT,
  REGION_DISTANCE_DEFAULT,
  airportTransferFareMinor,
  airportTransferQuoteMinor,
  airportVehicleLabel,
  AIRPORT_FARE_DEFAULT,
  AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT,
} from '@/lib/services/pricing';
import { ServiceError } from '@/lib/services/errors';

const TIERS = [
  { label: 'Adult', amountEur: 75, maxGuests: null },
  { label: 'Child', amountEur: 45, maxGuests: null },
  { label: 'Private group', amountEur: 110, maxGuests: 6 },
];

const SIGHTSEEING = { sedanEur: 70, suvEur: 85, familyEur: 85, vanEur: 125, coasterEur: 225, maxParty: 25 };

describe('sightseeingQuote', () => {
  it('charges a flat price per vehicle bracket', () => {
    const cases: Array<[number, string, number]> = [
      [1, 'Sedan', 70],
      [4, 'Sedan', 70],
      [5, 'Family car', 85],
      [6, 'Family car', 85],
      [7, 'Van', 125],
      [14, 'Van', 125],
      [15, 'Coaster', 225],
      [25, 'Coaster', 225],
    ];
    for (const [people, vehicle, total] of cases) {
      const q = sightseeingQuote(people, false, SIGHTSEEING);
      expect(q.vehicle).toBe(vehicle);
      expect(q.totalEur).toBe(total);
    }
  });

  it('applies the €85 SUV upgrade only for parties of 1–4', () => {
    expect(sightseeingQuote(2, true, SIGHTSEEING)).toEqual({ vehicle: 'SUV', totalEur: 85 });
    expect(sightseeingQuote(4, true, SIGHTSEEING)).toEqual({ vehicle: 'SUV', totalEur: 85 });
    expect(sightseeingQuote(5, true, SIGHTSEEING)).toEqual({ vehicle: 'Family car', totalEur: 85 });
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

const D = REGION_DISTANCE_DEFAULT;
const B = TRANSPORT_BANDS_DEFAULT;

describe('regionDistanceBand', () => {
  it('is "same" for the same region', () => {
    expect(regionDistanceBand('West', 'West', D)).toBe('same');
    expect(regionDistanceBand('Central', 'Central', D)).toBe('same');
  });

  it('reads near/far from the seeded pairs', () => {
    expect(regionDistanceBand('North', 'West', D)).toBe('near');
    expect(regionDistanceBand('East', 'West', D)).toBe('far');
    expect(regionDistanceBand('North', 'South', D)).toBe('far');
    expect(regionDistanceBand('Central', 'East', D)).toBe('near');
  });

  it('is symmetric (order does not matter)', () => {
    expect(regionDistanceBand('West', 'East', D)).toBe(regionDistanceBand('East', 'West', D));
    expect(regionDistanceBand('South', 'North', D)).toBe(regionDistanceBand('North', 'South', D));
  });

  it('fails safe to "far" for a missing pair or a null region', () => {
    expect(regionDistanceBand('North', 'West', {})).toBe('far');
    expect(regionDistanceBand(null, 'West', D)).toBe('far');
    expect(regionDistanceBand('West', null, D)).toBe('far');
  });
});

describe('transportFareMinor', () => {
  it('prices each vehicle bracket within a band (same)', () => {
    // pax -> expected minor for the "same" band
    const cases: Array<[number, number]> = [
      [1, 1500], [4, 1500], // Sedan
      [5, 2500], [6, 2500], // Family
      [7, 4000], [14, 4000], // Van
      [15, 7000], [25, 7000], // Coaster
    ];
    for (const [pax, minor] of cases) {
      expect(transportFareMinor('West', 'West', pax, false, B, D)).toBe(minor);
    }
  });

  it('applies the SUV upgrade only for parties of 1–4', () => {
    expect(transportFareMinor('West', 'West', 2, true, B, D)).toBe(2000); // SUV same
    expect(transportFareMinor('West', 'West', 4, true, B, D)).toBe(2000);
    expect(transportFareMinor('West', 'West', 5, true, B, D)).toBe(2500); // suv ignored above 4
  });

  it('scales with distance band (same < near < far)', () => {
    const same = transportFareMinor('West', 'West', 2, false, B, D); // 1500
    const near = transportFareMinor('North', 'West', 2, false, B, D); // 3000
    const far = transportFareMinor('East', 'West', 2, false, B, D); // 5000
    expect(same).toBe(1500);
    expect(near).toBe(3000);
    expect(far).toBe(5000);
    expect(same).toBeLessThan(near);
    expect(near).toBeLessThan(far);
  });

  it('charges multiple coasters above 25 pax', () => {
    expect(transportFareMinor('East', 'West', 26, false, B, D)).toBe(18000 * 2);
    expect(transportFareMinor('East', 'West', 50, false, B, D)).toBe(18000 * 2);
    expect(transportFareMinor('East', 'West', 51, false, B, D)).toBe(18000 * 3);
  });

  it('returns 0 when a region or party is missing (no pickup -> no fee)', () => {
    expect(transportFareMinor(null, 'West', 2, false, B, D)).toBe(0);
    expect(transportFareMinor('North', null, 2, false, B, D)).toBe(0);
    expect(transportFareMinor('North', 'West', 0, false, B, D)).toBe(0);
  });
});

describe('transportFare (EUR)', () => {
  it('is the minor fare in euros', () => {
    expect(transportFare('West', 'West', 2, false, B, D)).toBe(15);
    expect(transportFare('East', 'West', 2, false, B, D)).toBe(50);
    expect(transportFare(null, 'West', 2, false, B, D)).toBe(0);
  });
});

// Airport transfers — must match airport_transfer_fare_minor() + the return discount in api_book.
const AF = AIRPORT_FARE_DEFAULT;

describe('airportTransferFareMinor', () => {
  it('picks the vehicle bracket by party size, per destination region', () => {
    // North: sedan 5000 / suv 6500 / family 8000 / van 12000 / coaster 20000
    expect(airportTransferFareMinor('North', 1, false, AF)).toBe(5000);
    expect(airportTransferFareMinor('North', 4, false, AF)).toBe(5000);
    expect(airportTransferFareMinor('North', 4, true, AF)).toBe(6500); // SUV upgrade ≤4
    expect(airportTransferFareMinor('North', 6, false, AF)).toBe(8000);
    expect(airportTransferFareMinor('North', 14, false, AF)).toBe(12000);
    expect(airportTransferFareMinor('North', 25, false, AF)).toBe(20000);
  });

  it('scales to multiple coasters above 25 and ignores SUV above 4', () => {
    expect(airportTransferFareMinor('South', 5, true, AF)).toBe(4000); // suv ignored above 4 → family
    expect(airportTransferFareMinor('North', 26, false, AF)).toBe(20000 * 2);
    expect(airportTransferFareMinor('North', 51, false, AF)).toBe(20000 * 3);
  });

  it('varies by region (South nearest, North farthest)', () => {
    expect(airportTransferFareMinor('South', 2, false, AF)).toBe(2500);
    expect(airportTransferFareMinor('North', 2, false, AF)).toBe(5000);
  });

  it('returns 0 on a missing/unknown region or empty party', () => {
    expect(airportTransferFareMinor(null, 2, false, AF)).toBe(0);
    expect(airportTransferFareMinor('Nowhere', 2, false, AF)).toBe(0);
    expect(airportTransferFareMinor('North', 0, false, AF)).toBe(0);
  });
});

describe('airportTransferQuoteMinor (one-way vs return)', () => {
  it('one-way is the matrix fare', () => {
    expect(airportTransferQuoteMinor('North', 8, false, 'one_way', AF, 10)).toBe(12000);
  });

  it('return is two legs minus the discount, rounded once', () => {
    // North van one-way 12000 → return = round(12000 * 2 * 0.9) = 21600
    expect(airportTransferQuoteMinor('North', 8, false, 'return', AF, 10)).toBe(21600);
    // West sedan 4000 → return @10% = round(4000*2*0.9) = 7200; @ default pct
    expect(
      airportTransferQuoteMinor('West', 2, false, 'return', AF, AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT),
    ).toBe(7200);
    // 0% discount → exactly double
    expect(airportTransferQuoteMinor('South', 2, false, 'return', AF, 0)).toBe(5000);
  });

  it('is 0 when the one-way fare is 0', () => {
    expect(airportTransferQuoteMinor(null, 2, false, 'return', AF, 10)).toBe(0);
  });
});

describe('airportVehicleLabel', () => {
  it('names the vehicle class by party size (+ SUV upgrade ≤4)', () => {
    expect(airportVehicleLabel(2, false)).toBe('Standard car');
    expect(airportVehicleLabel(4, true)).toBe('SUV');
    expect(airportVehicleLabel(6, false)).toBe('Family car');
    expect(airportVehicleLabel(14, false)).toBe('Minibus');
    expect(airportVehicleLabel(20, false)).toBe('Coaster');
  });
});
