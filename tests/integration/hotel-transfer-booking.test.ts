import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Hotel-to-hotel transfer booking: the server prices it from the DISTANCE BAND between the two hotels'
 * regions (derived zero-trust from the slugs, or area_region for a free-text end) × vehicle, applies the
 * return discount, and OVERRIDES the booking total. Seeded placeholder fares (party=2 → Sedan):
 *   same €25 · near €40 · far €60. Registry regions: lux-belle-mare=East, ambre-mauritius=East,
 *   trou-aux-biches-beachcomber=North, paradis-beachcomber=West (East|West=far, East|North=near).
 */

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [JSON.stringify(params)]);
  return rows[0]!.data;
}

const CUSTOMER = 'c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0';

describe('hotel-to-hotel transfer booking: band pricing + zero-trust', () => {
  let db: TestDb;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`);
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);

    // The hotel-transfer product is seeded in prod; create it here the same shape the migration expects:
    // a published is_hotel_transfer vehicle product with one option/price + a future occurrence. Vehicle
    // mode prices from sightseeing_pricing; api_book then OVERRIDES with the band fare.
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode, is_hotel_transfer)
         values ($1, 'hotel-transfer', 'transport', 'Hotel Transfer', 'Airport transfers', 'published', 'vehicle', true)
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    const optId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Per transfer') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
       values ($1, 'Transfer', 4000, null)`,
      [optId],
    );
    occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '2 days', now() + interval '2 days 1 hour', 40) returning id`,
        [optId, operatorId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  function book(extra: Record<string, unknown>, key: string) {
    return call<{ ref: string; totalEur: number }>(db, 'api_book', {
      occurrenceId,
      expectedSlug: 'hotel-transfer',
      party: { Transfer: 2 },
      customerName: 'H2H Tester',
      customerEmail: 'h2h@example.com',
      source: 'web',
      idempotencyKey: key,
      ...extra,
    });
  }

  it('prices a FAR pair (East→West) one-way at €60 and stores the pickup hotel', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await book(
      { pickupSlug: 'lux-belle-mare', dropoffSlug: 'paradis-beachcomber', tripType: 'one_way' },
      'h2h-far-00000001',
    );
    expect(booking.totalEur).toBe(60); // far band, Sedan

    const got = await call<Record<string, unknown>>(db, 'api_get_booking', { ref: booking.ref });
    expect(got.pickupHotelSlug).toBe('lux-belle-mare');
    expect(got.pickupRegion).toBe('East');
    expect(got.tripType).toBe('one_way');
  });

  it('prices a SAME-coast pair (East→East) at €25', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await book(
      { pickupSlug: 'lux-belle-mare', dropoffSlug: 'ambre-mauritius', tripType: 'one_way' },
      'h2h-same-00000001',
    );
    expect(booking.totalEur).toBe(25); // same band, Sedan
  });

  it('prices a NEAR return pair (East→North) at €72 (€40 × 2 − 10%)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await book(
      { pickupSlug: 'lux-belle-mare', dropoffSlug: 'trou-aux-biches-beachcomber', tripType: 'return' },
      'h2h-near-ret-0001',
    );
    expect(booking.totalEur).toBe(72); // 40 × 2 × 0.9
  });

  it('rejects a same-hotel trip (pickup == dropoff)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      book({ pickupSlug: 'lux-belle-mare', dropoffSlug: 'lux-belle-mare' }, 'h2h-same-hotel-1'),
    ).rejects.toThrow(/same_hotel/);
  });

  it('classifies a free-text drop-off AREA (Grand Baie → North) → near = €40', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await book(
      { pickupSlug: 'lux-belle-mare', dropoffArea: 'Grand Baie', tripType: 'one_way' },
      'h2h-freetext-0001',
    );
    expect(booking.totalEur).toBe(40); // East→North = near, Sedan
  });

  it('prices a free Google Places pair by COORDINATES (East→West) → far = €60, coords beat an unknown area', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await book(
      {
        // "Casuarina" isn't a known area (area_region → null), but the coords resolve the region: an
        // East-coast pickup (Belle Mare) and a West-coast drop-off (Flic en Flac) → far band, Sedan.
        pickupArea: 'Casuarina',
        pickupLat: -20.2,
        pickupLng: 57.77,
        dropoffArea: 'Nowhere in the list',
        dropoffLat: -20.3,
        dropoffLng: 57.37,
        tripType: 'one_way',
      },
      'h2h-coords-0001',
    );
    expect(booking.totalEur).toBe(60); // East→West = far, Sedan — derived from coords, not the area text

    const got = await call<Record<string, unknown>>(db, 'api_get_booking', { ref: booking.ref });
    expect(got.pickupRegion).toBe('East'); // region_from_coords(pickup), not area_region('Casuarina')
  });

  it('exposes the live hotel band fares + region distances on the activity DTO', async () => {
    const act = await call<{
      isHotelTransfer: boolean;
      hotelTransferFares: Record<string, { sedanMinor: number }> | null;
      regionDistances: Record<string, string> | null;
      returnDiscountPct: number | null;
    }>(db, 'api_get_activity', { slug: 'hotel-transfer' });
    expect(act.isHotelTransfer).toBe(true);
    expect(act.hotelTransferFares?.far?.sedanMinor).toBe(6000);
    expect(act.regionDistances?.['East|West']).toBe('far');
    expect(act.returnDiscountPct).toBe(10);
  });
});
