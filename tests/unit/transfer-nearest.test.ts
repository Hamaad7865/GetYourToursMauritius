import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nearestTransfer, transfers } from '@/lib/content/transfers';

/**
 * The airport price tool lets a guest type ANY hotel in Mauritius via Google Places, then snaps the
 * pick to the nearest hotel we actually list, because airport fares are set per ZONE rather than per
 * hotel. That snap is invisible maths behind a booking decision, so it is pinned here.
 *
 * The reported case: a guest picked Veranda Palmar Beach and the field changed to "The Residence
 * Mauritius". That looked like the site substituting a different hotel; the fare was right (same
 * zone), and AirportQuote now keeps the guest's own hotel in the field and names the zone instead.
 *
 * The Residence was also only "nearest" because of coordinate drift: the original hand-curated
 * table had LUX* Belle Mare 1.3 km from where it stands. With the 2026-08-04 geocoded table the
 * true neighbour is LUX* Belle Mare, 0.22 km up the same beach (The Residence is 0.50 km, Ambre
 * 0.68 km). Same zone either way — the fare never changed — but the hotel we NAME to the guest in
 * the zone-fare note is now the one actually next door.
 */

/**
 * Veranda Palmar Beach as Google geocodes it (2026-08-04) — the coordinates the Places pick actually
 * hands to nearestTransfer. Deliberately NOT one of our stored positions: this is the outside input.
 */
const VERANDA_PALMAR = { lat: -20.20074, lng: 57.78339 };

describe('nearestTransfer', () => {
  it('snaps an unlisted Belle Mare hotel to the closest listed one', () => {
    expect(nearestTransfer(VERANDA_PALMAR.lat, VERANDA_PALMAR.lng).slug).toBe('lux-belle-mare');
  });

  // The whole justification for snapping is that the fare cannot change. If a future map edit moves
  // a hotel across a zone boundary, the snapped price would silently stop matching the guest's
  // actual destination — so assert the neighbourhood shares one region.
  it('snaps to a hotel in the same region, so the zone fare still applies', () => {
    const snapped = nearestTransfer(VERANDA_PALMAR.lat, VERANDA_PALMAR.lng);
    expect(snapped.region).toBe('East');
  });

  // Every hotel must be its own nearest match. If two entries ever sat close enough to swap, a guest
  // picking one off the map would be quoted against the other — and the resorts along Belle Mare are
  // already within a kilometre of each other.
  it('resolves every listed hotel to itself from its own coordinates', () => {
    const swapped = transfers
      .filter((t) => t.lat != null && t.lng != null)
      .map((t) => ({ slug: t.slug, got: nearestTransfer(t.lat!, t.lng!).slug }))
      .filter((r) => r.got !== r.slug);
    expect(swapped).toEqual([]);
  });

  // A hotel with no coordinates is skipped by the loop; if EVERY entry lacked them the function
  // would silently hand back transfers[0] for the whole island.
  it('has coordinates on every listed hotel', () => {
    const missing = transfers.filter((t) => t.lat == null || t.lng == null).map((t) => t.slug);
    expect(missing).toEqual([]);
  });

  it('always returns a listed hotel, even for a point far offshore', () => {
    const far = nearestTransfer(-21.5, 59.5);
    expect(transfers.some((t) => t.slug === far.slug)).toBe(true);
  });
});

/**
 * The snap is a PRICING device, and the owner's 2026-08-05 directive is that the hotel it lands on is
 * never named to the guest. The field was fixed for that; the summary panel was not — pick "Veranda
 * Palmar Beach" and the priced destination chip still read "LUX* Belle Mare", so the console answered
 * a question about a resort the guest had not asked about.
 *
 * Source-scanned rather than rendered: this leaks back the moment someone reaches for the nearer
 * variable, and `hotel` legitimately appears all over the file for pricing.
 */
describe('AirportQuote never names the snapped hotel to the guest', () => {
  const src = readFileSync('src/components/transfers/AirportQuote.tsx', 'utf8');

  it('derives one display name from the guest pick', () => {
    expect(src).toMatch(/const displayName = picked\?\.name \?\? hotel\.hotelName;/);
  });

  it('renders no anchor name as JSX text', () => {
    expect(src).not.toMatch(/>\s*\{hotel\.hotelName\}/);
  });

  it('passes no anchor name into a translated label', () => {
    expect(src).not.toMatch(/hotel:\s*hotel\.hotelName/);
  });

  // The route preview is the other place the anchor showed through — it drew the line to the listed
  // hotel's coordinates while the panel above it quoted the guest's own.
  it('routes the map to the guest coordinates when they picked their own hotel', () => {
    expect(src).toMatch(/const daddr = picked\s*\n?\s*\? `\$\{picked\.lat\},\$\{picked\.lng\}`/);
  });
});
