import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { seedOccurrence, seedPrivateOption, type SeedResult } from '../db/seed';

/**
 * api_admin_calendar_month.seats_left must be denominated in booking UNITS, not the guest headcount.
 *
 * session_occurrences.capacity counts UNITS — guests for a seat tour, but TRIPS for a private option
 * and VEHICLES for vehicle mode (the same count used_capacity / api_reschedule_booking gate on). The
 * RPC used to subtract the headcount (Σ pax) from that unit pool, so a 6-guest van on a 10-vehicle/day
 * option reported seats_left = 4 instead of 9. This is the SQL twin of the day-sheet ratio fix
 * (DayDeparture.units, commit 8b6cb93); `pax` stays the headcount the month grid renders, only
 * seats_left switches to Σ quantity. See migration 20261002000000_calendar_month_seats_units.
 *
 * Each test parks its occurrence on its OWN future day, because the RPC aggregates per Mauritius-local
 * day across the whole catalogue — two departures on the same day would sum together.
 */
const STAFF = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8';
const PRIVATE_CFG = {
  baseMinor: 9000,
  included: 4,
  extraMinor: 2500,
  maxGuests: 8,
  tripsPerDay: 10,
};

interface MonthCell {
  day: string;
  departures: number;
  cancelled: number;
  pax: number;
  seatsLeft: number;
}

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

async function activitySlug(db: TestDb, activityId: string): Promise<string> {
  const { rows } = await db.pg.query<{ slug: string }>(
    `select slug from activities where id = $1`,
    [activityId],
  );
  return rows[0]!.slug;
}

/** Move an occurrence onto its own future day so it is the only departure in the queried range. */
async function moveToDay(db: TestDb, occurrenceId: string, daysFromNow: number): Promise<void> {
  await db.pg.query(
    `update session_occurrences
        set starts_at = now() + make_interval(days => $2::int),
            ends_at   = now() + make_interval(days => $2::int) + interval '4 hours'
      where id = $1`,
    [occurrenceId, daysFromNow],
  );
}

/** The occurrence's Mauritius-local calendar day, exactly how the RPC buckets it. */
async function mauritiusDay(db: TestDb, occurrenceId: string): Promise<string> {
  const { rows } = await db.pg.query<{ d: string }>(
    `select (starts_at at time zone 'Indian/Mauritius')::date::text as d
       from session_occurrences where id = $1`,
    [occurrenceId],
  );
  return rows[0]!.d;
}

/** Pay a held booking in full so it becomes 'confirmed' — the only status the month RPC counts. */
async function confirmBooking(db: TestDb, idempotencyKey: string): Promise<string> {
  const { rows: b } = await db.pg.query<{ id: string; total_minor: number }>(
    `select id, total_minor from bookings where idempotency_key = $1`,
    [idempotencyKey],
  );
  const bookingId = b[0]!.id;
  const total = Number(b[0]!.total_minor);
  const { rows: p } = await db.pg.query<{ id: string }>(
    `insert into payments (booking_id, idempotency_key, amount_minor) values ($1, $2, $3) returning id`,
    [bookingId, `pay-${idempotencyKey}`, total],
  );
  await db.pg.query(
    `select * from append_payment_event($1, $2, $3, $4, $5::timestamptz, $6::jsonb)`,
    [p[0]!.id, 'paid', `evt-${idempotencyKey}`, total, new Date().toISOString(), '{}'],
  );
  const { rows: st } = await db.pg.query<{ status: string }>(
    `select status from bookings where id = $1`,
    [bookingId],
  );
  return st[0]!.status;
}

/** Call the staff-gated month RPC as STAFF, then restore the owner context for further seeding. */
async function monthCell(db: TestDb, day: string): Promise<MonthCell> {
  await db.as({ sub: STAFF, role: 'authenticated' });
  try {
    const cells = await call<MonthCell[]>(db, 'api_admin_calendar_month', { from: day, to: day });
    return cells.find((c) => c.day === day)!;
  } finally {
    await db.asOwner();
  }
}

describe('api_admin_calendar_month — seats_left is denominated in booking UNITS, not guests', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [STAFF]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('a private/vehicle day subtracts UNITS (one trip), not the guest headcount', async () => {
    await db.asOwner();
    const seed: SeedResult = await seedOccurrence(db, 10);
    const priv = await seedPrivateOption(db, seed, PRIVATE_CFG); // 10 trips/day pool
    // Isolate the day: drop the sibling shared occurrence and give the private one its own future day.
    await db.pg.query(`delete from session_occurrences where id = $1`, [seed.occurrenceId]);
    await moveToDay(db, priv.occurrenceId, 5);

    // 6 guests ride ONE trip → quantity 1, pax 6 (the vehicle-mode contract).
    await apiBook(db, {
      occurrenceId: priv.occurrenceId,
      expectedSlug: await activitySlug(db, seed.activityId),
      party: { 'Private charter': 6 },
      customerName: 'Van Party',
      customerEmail: 'van@example.com',
      source: 'web',
      idempotencyKey: 'cal-priv',
    });
    expect(await confirmBooking(db, 'cal-priv')).toBe('confirmed');

    const cell = await monthCell(db, await mauritiusDay(db, priv.occurrenceId));
    expect(cell.departures).toBe(1);
    // pax stays the HEADCOUNT — the month grid renders this as the day's guest count.
    expect(cell.pax).toBe(6);
    // seats_left = 10-vehicle pool − 1 UNIT = 9. The bug subtracted 6 guests → 4.
    expect(cell.seatsLeft).toBe(9);
  });

  it('a seat tour is unchanged: each guest IS a unit, so seats_left = capacity − guests', async () => {
    await db.asOwner();
    const seed: SeedResult = await seedOccurrence(db, 10); // shared 'Adult' €75, capacity 10 seats
    await moveToDay(db, seed.occurrenceId, 9);

    await apiBook(db, {
      occurrenceId: seed.occurrenceId,
      expectedSlug: await activitySlug(db, seed.activityId),
      party: { Adult: 3 },
      customerName: 'Seat Party',
      customerEmail: 'seat@example.com',
      source: 'web',
      idempotencyKey: 'cal-seat',
    });
    expect(await confirmBooking(db, 'cal-seat')).toBe('confirmed');

    const cell = await monthCell(db, await mauritiusDay(db, seed.occurrenceId));
    expect(cell.departures).toBe(1);
    expect(cell.pax).toBe(3);
    // units === guests for a seat tour, so the fix leaves this untouched: 10 − 3 = 7.
    expect(cell.seatsLeft).toBe(7);
  });
});
