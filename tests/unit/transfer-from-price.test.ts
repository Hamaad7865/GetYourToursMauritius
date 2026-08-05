import { describe, expect, it } from 'vitest';
import { transfers } from '@/lib/content/transfers';
import { transferFromPriceEur } from '@/lib/transfers/from-price';
import {
  AIRPORT_FARE_DEFAULT,
  airportTransferQuote,
  airportZoneForSlug,
  type AirportFareByZone,
} from '@/lib/services/pricing';

/**
 * The "from €X / car" a transfer page advertises must be the fare the booking widget then quotes.
 *
 * It wasn't: the pages carried a hardcoded per-region estimate (South 25 / East 35 / Central 30 /
 * West 40 / North 50) written when airport fares were region-based. The fare model became ZONE-based
 * and the constant never followed, so every one of the 45 hotel pages advertised BELOW the real
 * price — Belle Mare said "from €35" against a €55 charge — and that number rode into the meta
 * description, the JSON-LD Offer and the map pins. These pin the two together.
 */
describe('transferFromPriceEur', () => {
  it("is the hotel's own zone fare for a standard car, one way", () => {
    // Zone 2 (near-airport) vs zone 1 (everywhere else), off the seeded matrix.
    expect(transferFromPriceEur('preskil-island-resort', AIRPORT_FARE_DEFAULT)).toBe(35);
    expect(transferFromPriceEur('lux-belle-mare', AIRPORT_FARE_DEFAULT)).toBe(55);
  });

  it('tracks the live matrix rather than any bundled number', () => {
    const tuned: AirportFareByZone = {
      zone1: { ...AIRPORT_FARE_DEFAULT.zone1!, sedanMinor: 4900 },
      zone2: { ...AIRPORT_FARE_DEFAULT.zone2!, sedanMinor: 2900 },
    };
    // An owner re-pricing in admin → Pricing must move the advertised figure with it.
    expect(transferFromPriceEur('preskil-island-resort', tuned)).toBe(29);
    expect(transferFromPriceEur('lux-belle-mare', tuned)).toBe(49);
  });

  it('matches what the booking widget quotes for that hotel, for EVERY listed hotel', () => {
    // The widget prices with airportTransferQuote(zone, pax, suv, tripType, fares, returnPct); the
    // page's headline claim is the same call at its cheapest: 4 pax or fewer, no SUV, one way.
    for (const hotel of transfers) {
      const widget = airportTransferQuote(
        airportZoneForSlug(hotel.slug),
        4,
        false,
        'one_way',
        AIRPORT_FARE_DEFAULT,
        10,
      );
      expect(
        transferFromPriceEur(hotel.slug, AIRPORT_FARE_DEFAULT),
        `${hotel.slug} advertises a price the widget does not quote`,
      ).toBe(widget);
    }
  });

  it('never advertises less than the guest is charged (the regression that shipped)', () => {
    const OLD_REGION_ESTIMATE: Record<string, number> = {
      South: 25,
      East: 35,
      Central: 30,
      West: 40,
      North: 50,
    };
    // Proves the old constant really did undercut the live fares — so nobody reinstates it as a
    // "nicer looking" number: every hotel it covered was advertised below its own zone fare.
    for (const hotel of transfers) {
      const real = transferFromPriceEur(hotel.slug, AIRPORT_FARE_DEFAULT);
      expect(real).toBeGreaterThanOrEqual(OLD_REGION_ESTIMATE[hotel.region] ?? 0);
    }
  });
});
