import { describe, expect, it } from 'vitest';
import {
  areaRegion,
  hotelTransferQuoteMinor,
  HOTEL_TRANSFER_FARE_DEFAULT as F,
  REGION_DISTANCE_DEFAULT as D,
} from '@/lib/services/pricing';
import { TRANSFER_LOCATIONS } from '@/lib/content/transfer-locations';

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

// Mirrors the SQL area_region() classifier — the integration test confirms the SQL side agrees, so the
// client display quote for a free-text "location" matches the server-charged region cent-for-cent.
describe('areaRegion — free-text place → region parity with the SQL', () => {
  it('classifies one representative place per region (accent/apostrophe/case-insensitive)', () => {
    expect(areaRegion('Grand Baie')).toBe('North');
    expect(areaRegion('  PORT LOUIS ')).toBe('North');
    expect(areaRegion('Belle Mare')).toBe('East');
    expect(areaRegion('Mahébourg')).toBe('South');
    expect(areaRegion("Pointe d'Esny")).toBe('South');
    expect(areaRegion('Flic en Flac')).toBe('West');
    expect(areaRegion('Le Morne')).toBe('West');
    expect(areaRegion('Quatre Bornes')).toBe('Central');
    expect(areaRegion('Ébène')).toBe('Central');
  });
  it('returns null for blank or unknown text (→ far band downstream)', () => {
    expect(areaRegion('')).toBeNull();
    expect(areaRegion(null)).toBeNull();
    expect(areaRegion('Atlantis')).toBeNull();
  });
});

// Every curated picker location must classify to its declared region, or the instant display quote would
// diverge from what the server charges (the server re-derives the region from the same label text).
describe('TRANSFER_LOCATIONS — each curated place agrees with areaRegion(label)', () => {
  it.each(TRANSFER_LOCATIONS.map((l) => [l.label, l.region] as const))(
    '%s → %s',
    (label, region) => {
      expect(areaRegion(label)).toBe(region);
    },
  );
});
