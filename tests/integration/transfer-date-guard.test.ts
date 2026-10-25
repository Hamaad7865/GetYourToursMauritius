import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { mapDbError } from '@/lib/services/db-errors';
import type { ServiceError } from '@/lib/services/errors';

/**
 * api_book's first-leg date backstop (20261025120000_transfer_first_leg_date_guard).
 *
 * An airport transfer's only first-leg date is the day-slot it holds. Prod departure-only bookings
 * BMT61C672F6CC1B6 / BMT128D90D2935B0 held 2026-10-09 while the guest left on 2026-10-15 — the
 * checkout sent the real day in returnDate and nothing tied it to the slot. The client is fixed; this
 * pins the server refusing a stale or crafted client: a departure's returnDate must BE the slot's
 * Mauritius day, a return's second leg may not come before it, and an arrival is untouched.
 *
 * Every slot day is read back from Postgres (starts_at at Indian/Mauritius), never computed in JS, so
 * the suite does not shift when it runs after 20:00 UTC.
 */

const CUSTOMER = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8';

describe('api_book: an airport transfer holds the day of its first leg', () => {
  let db: TestDb;
  let operatorId: string;
  let optionId: string;
  /** Noon Mauritius — the shape materialize_availability mints. */
  let noonOcc: string;
  let noonDay: string;
  /** 22:00 UTC — already the NEXT calendar day in Mauritius (UTC+4). */
  let lateOcc: string;
  let lateDay: string;
  let lateUtcDay: string;
  let seq = 0;

  async function sql<T>(text: string, params: unknown[] = []): Promise<T> {
    await db.asOwner();
    const { rows } = await db.pg.query<T>(text, params);
    return rows[0]!;
  }

  async function addOccurrence(startsAtSql: string): Promise<string> {
    return (
      await sql<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, ${startsAtSql}, ${startsAtSql} + interval '1 hour', 40) returning id`,
        [optionId, operatorId],
      )
    ).id;
  }

  async function shift(day: string, days: number): Promise<string> {
    return (await sql<{ d: string }>(`select ($1::date + $2::int)::text as d`, [day, days])).d;
  }

  async function book(occurrenceId: string, extra: Record<string, unknown>) {
    seq += 1;
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    return apiBook<{ ref: string }>(db, {
      occurrenceId,
      expectedSlug: 'airport-transfer',
      party: { Transfer: 2 },
      dropoffSlug: 'shandrani-beachcomber',
      customerName: 'Date Guard',
      customerEmail: 'date-guard@example.com',
      source: 'web',
      idempotencyKey: `date-guard-${seq}-00000000`,
      ...extra,
    });
  }

  /** Book, expect a refusal, and return what the service layer would hand the guest. */
  async function refusal(occurrenceId: string, extra: Record<string, unknown>) {
    const raw = await book(occurrenceId, extra).then(
      () => null,
      (error: unknown) => error,
    );
    expect(raw, 'api_book minted a booking instead of refusing').not.toBeNull();
    expect(String(raw instanceof Error ? raw.message : raw)).toMatch(/transfer_date_mismatch/);
    try {
      mapDbError(raw);
    } catch (mapped) {
      return mapped as ServiceError;
    }
    throw new Error('unreachable — mapDbError always throws');
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    operatorId = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours') returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
    // The airport-transfer product lives in seed.sql, not the migrations — same shape as
    // airport-transfer-booking.test.ts.
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode, is_airport_transfer)
         values ($1, 'airport-transfer', 'transport', 'Airport Transfer', 'Airport transfers', 'published', 'vehicle', true)
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Per transfer') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
       values ($1, 'Transfer', 3600, null)`,
      [optionId],
    );

    noonOcc = await addOccurrence(
      `((current_date + 5) + time '12:00') at time zone 'Indian/Mauritius'`,
    );
    lateOcc = await addOccurrence(`((current_date + 6) + time '22:00') at time zone 'UTC'`);
    const day = `(starts_at at time zone 'Indian/Mauritius')::date::text`;
    noonDay = (
      await sql<{ d: string }>(`select ${day} as d from session_occurrences where id = $1`, [
        noonOcc,
      ])
    ).d;
    ({ d: lateDay, u: lateUtcDay } = await sql<{ d: string; u: string }>(
      `select ${day} as d, (starts_at at time zone 'UTC')::date::text as u
         from session_occurrences where id = $1`,
      [lateOcc],
    ));
    expect(lateDay).not.toBe(lateUtcDay); // the fixture really straddles midnight
  });

  afterAll(async () => {
    await db.close();
  });

  it('books a departure whose hotel pickup is the slot’s own day', async () => {
    const booking = await book(noonOcc, {
      tripDirection: 'departure',
      returnDate: noonDay,
      returnTime: '09:00',
      departureFlightNumber: 'MK014',
    });
    const row = await sql<{ trip_direction: string; return_date: string }>(
      `select trip_direction, return_date::text from bookings where ref = $1`,
      [booking.ref],
    );
    expect(row).toEqual({ trip_direction: 'departure', return_date: noonDay });
  });

  it('refuses a departure that leaves on another day — and leaves no booking or hold behind', async () => {
    const holdsBefore = await sql<{ n: number }>(
      `select count(*)::int as n from booking_holds where session_occurrence_id = $1`,
      [noonOcc],
    );
    // The prod shape: slot on one day, the guest's real departure six days later.
    const err = await refusal(noonOcc, {
      tripDirection: 'departure',
      returnDate: await shift(noonDay, 6),
      returnTime: '09:00',
    });
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation_error');
    expect(err.message).toMatch(/choose your date again/);

    const after = await sql<{ bookings: number; holds: number }>(
      `select (select count(*)::int from bookings where idempotency_key = $1) as bookings,
              (select count(*)::int from booking_holds where session_occurrence_id = $2) as holds`,
      [`date-guard-${seq}-00000000`, noonOcc],
    );
    expect(after).toEqual({ bookings: 0, holds: holdsBefore.n });
  });

  it('refuses a departure with no pickup date at all', async () => {
    await refusal(noonOcc, { tripDirection: 'departure', returnTime: '09:00' });
  });

  it('reads the slot day in Mauritius time, not UTC', async () => {
    await refusal(lateOcc, { tripDirection: 'departure', returnDate: lateUtcDay });
    const booking = await book(lateOcc, { tripDirection: 'departure', returnDate: lateDay });
    expect(booking.ref).toBeTruthy();
  });

  it('refuses a return whose second leg comes before the slot day', async () => {
    const dayBefore = await shift(noonDay, -1);
    await refusal(noonOcc, { tripDirection: 'return', returnDate: dayBefore });
    // A legacy client that only sends tripType resolves to a return and is held to the same rule.
    await refusal(noonOcc, { tripType: 'return', returnDate: dayBefore });
  });

  it('books a return leaving the same day, a later day, or with no second-leg date yet', async () => {
    for (const returnDate of [noonDay, await shift(noonDay, 4), undefined]) {
      const booking = await book(noonOcc, { tripDirection: 'return', returnDate });
      expect(booking.ref).toBeTruthy();
    }
  });

  it('leaves arrivals alone — their only date IS the slot', async () => {
    expect((await book(noonOcc, { tripDirection: 'arrival' })).ref).toBeTruthy();
    // A stray returnDate on an arrival is not a first-leg date, so the guard does not read it.
    const stray = await book(noonOcc, {
      tripDirection: 'arrival',
      returnDate: await shift(noonDay, -3),
    });
    expect(stray.ref).toBeTruthy();
  });
});
