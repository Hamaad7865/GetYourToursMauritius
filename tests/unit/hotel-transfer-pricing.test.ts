import { describe, expect, it } from 'vitest';
import {
  hotelTransferQuoteMinor,
  HOTEL_TRANSFER_FARE_DEFAULT as F,
  REGION_DISTANCE_DEFAULT as D,
} from '@/lib/services/pricing';

// Mirrors the SQL hotel_transfer_fare_minor + region_distance_band + the return formula in api_book
// (the integration test confirms the SQL side returns the same euros).
describe('hotelTransferQuoteMinor — band × vehicle parity with the SQL', () => {
  it('far pair (East→West), party 2, one-way = 6000 (€60)', () => {
    expect(hotelTransferQuoteMinor('East', 'West', 2, false, 'one_way', F, D, 10)).toBe(6000);
  });
  it('same coast (East→East) = 2500 (€25)', () => {
    expect(hotelTransferQuoteMinor('East', 'East', 2, false, 'one_way', F, D, 10)).toBe(2500);
  });
  it('near return (East→North) = 7200 (4000 × 2 × 0.9)', () => {
    expect(hotelTransferQuoteMinor('East', 'North', 2, false, 'return', F, D, 10)).toBe(7200);
  });
  it('vehicle brackets on a far pair: 6 → family, 14 → van, 25 → coaster, 26 → ×2 coaster', () => {
    expect(hotelTransferQuoteMinor('East', 'West', 6, false, 'one_way', F, D, 10)).toBe(8500);
    expect(hotelTransferQuoteMinor('East', 'West', 14, false, 'one_way', F, D, 10)).toBe(13000);
    expect(hotelTransferQuoteMinor('East', 'West', 25, false, 'one_way', F, D, 10)).toBe(22000);
    expect(hotelTransferQuoteMinor('East', 'West', 26, false, 'one_way', F, D, 10)).toBe(44000);
  });
  it('SUV is the ≤4 upgrade (far) = 7500', () => {
    expect(hotelTransferQuoteMinor('East', 'West', 2, true, 'one_way', F, D, 10)).toBe(7500);
  });
  it('a null/unknown region fails safe to the far band (never under-prices)', () => {
    expect(hotelTransferQuoteMinor(null, 'West', 2, false, 'one_way', F, D, 10)).toBe(6000);
  });
});
