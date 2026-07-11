import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Airport-transfer booking (AT-2): the server prices it from the destination ZONE (derived zero-trust
 * from the hotel slug) × vehicle, applies the return discount, and persists the new booking-form fields
 * (trip_direction, traveller + trip details). Books the seeded `airport-transfer` activity to
 * shandrani-beachcomber (a Zone 2 hotel), party=2 → Standard car Zone 2 = €35 (3500 minor) one-way; a
 * return is 2 legs − the 10% discount = 6300 minor. Also checks the free-text "not listed" area→zone
 * fallback and that the new fields persist on booking_json.
 */

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

const CUSTOMER = 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7';

describe('airport-transfer booking: zone pricing + the new form fields persist', () => {
  let db: TestDb;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);

    // The seeded airport-transfer PRODUCT lives in seed.sql / catch-up.sql, not in the migrations the
    // PGlite harness applies — so create it here (the same shape the migration configures: a published,
    // is_airport_transfer vehicle product with one option/price + a future occurrence). Vehicle mode
    // prices from sightseeing_pricing (seeded by the migrations); api_book then OVERRIDES with the zone fare.
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode, is_airport_transfer)
         values ($1, 'airport-transfer', 'transport', 'Airport Transfer', 'Airport transfers', 'published', 'vehicle', true)
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
       values ($1, 'Transfer', 3600, null)`,
      [optId],
    );
    occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '2 days', now() + interval '2 days 1 hour', 40) returning id`,
        [optId, operatorId],
      )
    ).rows[0]!.id;
    expect(occurrenceId).toBeTruthy();
  });

  afterAll(async () => {
    await db.close();
  });

  it('prices a one-way Zone 2 arrival at €35 and persists the trip + traveller fields', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string; totalEur: number }>(db, 'api_book', {
      occurrenceId,
      expectedSlug: 'airport-transfer',
      party: { Transfer: 2 },
      dropoffSlug: 'shandrani-beachcomber',
      tripDirection: 'arrival',
      flightNumber: 'MK015',
      arrivalTime: '14:30',
      roomOrCabin: 'Room 214',
      luggageDetails: '3 large suitcases',
      childSeatAge: 3,
      travellerGender: 'female',
      travellerCompany: 'Acme Ltd',
      travellerCountry: 'France',
      specialNotes: 'Please wait at gate B',
      customerName: 'Arrival Tester',
      customerEmail: 'arrival@example.com',
      source: 'web',
      idempotencyKey: 'at-arrival-12345678',
    });
    expect(booking.totalEur).toBe(35); // Zone 2 Standard car, one-way

    const got = await call<Record<string, unknown>>(db, 'api_get_booking', { ref: booking.ref });
    expect(got.tripDirection).toBe('arrival');
    expect(got.tripType).toBe('one_way');
    expect(got.flightNumber).toBe('MK015');
    expect(got.arrivalTime).toBe('14:30');
    expect(got.roomOrCabin).toBe('Room 214');
    expect(got.luggageDetails).toBe('3 large suitcases');
    expect(got.childSeatAge).toBe(3);
    expect(got.travellerGender).toBe('female');
    expect(got.travellerCompany).toBe('Acme Ltd');
    expect(got.travellerCountry).toBe('France');
    expect(got.specialNotes).toBe('Please wait at gate B');
    expect(got.dropoffLocation).toBeNull(); // none sent here (the checkout sends the hotel name on the real path)
  });

  it('prices a return Zone 2 trip at €63 (2 legs − 10%) and stores both legs', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string; totalEur: number }>(db, 'api_book', {
      occurrenceId,
      expectedSlug: 'airport-transfer',
      party: { Transfer: 2 },
      dropoffSlug: 'shandrani-beachcomber',
      dropoffLocation: 'Shandrani Beachcomber Resort & Spa',
      tripDirection: 'return',
      flightNumber: 'MK015',
      arrivalTime: '14:30',
      returnDate: '2026-08-01',
      returnTime: '10:00',
      departureFlightNumber: 'MK014',
      customerName: 'Return Tester',
      customerEmail: 'return@example.com',
      source: 'web',
      idempotencyKey: 'at-return-12345678',
    });
    expect(booking.totalEur).toBe(63); // 35 × 2 × (100 − 10)/100 = 63

    const got = await call<Record<string, unknown>>(db, 'api_get_booking', { ref: booking.ref });
    expect(got.tripDirection).toBe('return');
    expect(got.tripType).toBe('return');
    expect(got.departureFlightNumber).toBe('MK014');
    expect(got.returnTime).toBe('10:00');
    expect(got.returnDate).toBe('2026-08-01');
    expect(got.dropoffLocation).toBe('Shandrani Beachcomber Resort & Spa');
  });

  it('classifies a free-text "not listed" Zone 2 area (Mahébourg) from the area, no slug needed', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string; totalEur: number }>(db, 'api_book', {
      occurrenceId,
      expectedSlug: 'airport-transfer',
      party: { Transfer: 2 },
      // No dropoffSlug — the guest's hotel isn't listed; the server classifies the zone from the area.
      dropoffArea: 'Mahébourg',
      dropoffLocation: 'Chez Tony Guesthouse',
      tripDirection: 'arrival',
      flightNumber: 'BA2065',
      arrivalTime: '09:00',
      customerName: 'NotListed Tester',
      customerEmail: 'notlisted@example.com',
      source: 'web',
      idempotencyKey: 'at-notlisted-1234567',
    });
    expect(booking.totalEur).toBe(35); // Mahébourg → Zone 2 → €35

    // A non-Zone-2 area (e.g. Grand Baie) prices at Zone 1.
    const z1 = await call<{ totalEur: number }>(db, 'api_book', {
      occurrenceId,
      expectedSlug: 'airport-transfer',
      party: { Transfer: 2 },
      dropoffArea: 'Grand Baie',
      tripDirection: 'arrival',
      flightNumber: 'BA2065',
      arrivalTime: '09:00',
      customerName: 'Zone1 Tester',
      customerEmail: 'zone1@example.com',
      source: 'web',
      idempotencyKey: 'at-zone1-12345678',
    });
    expect(z1.totalEur).toBe(55); // Zone 1 Standard car placeholder = €55
  });

  it('zones the newly-added Anantara IKO hotel as Zone 2', async () => {
    await db.asOwner();
    const row = (
      await db.pg.query<{ zone: string }>(
        `select zone from airport_transfer_hotels where slug = 'anantara-iko-mauritius'`,
      )
    ).rows[0];
    expect(row?.zone).toBe('zone2');
  });
});
