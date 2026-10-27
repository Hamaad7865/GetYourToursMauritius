import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { seedOccurrence, type SeedResult } from '../db/seed';

/**
 * One departure can leave at a different time from its tour's usual start (20261027130000). Staff set
 * it from the calendar through api_admin_set_departure_time; it wins over the option's and activity's
 * start time everywhere, including the guest's confirmation email + invoice (api_booking_receipt).
 */
const CUSTOMER = 'cafe0000-0000-4000-8000-0000000000c1';
const STAFF = 'beef0000-0000-4000-8000-0000000000f1';

describe('api_admin_set_departure_time', () => {
  let db: TestDb;
  let seed: SeedResult;
  let bookingId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const id of [CUSTOMER, STAFF]) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
    }
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [STAFF]);
    seed = await seedOccurrence(db, 20);
    await db.pg.query(
      `update activities set extra = coalesce(extra, '{}'::jsonb) || '{"startWindow":"09:00"}' where id = $1`,
      [seed.activityId],
    );
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId: seed.occurrenceId,
      party: { Adult: 2 },
      customerName: 'Jean Dupont',
      customerEmail: 'jean@example.com',
      source: 'web',
      idempotencyKey: 'departure-override-12345678',
    });
    await db.asOwner();
    bookingId = (
      await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [booking.ref])
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  async function setTime(time: string | null, occurrenceId = seed.occurrenceId) {
    const { rows } = await db.pg.query<{ data: { occurrenceId: string; departureTime: string } }>(
      `select api_admin_set_departure_time($1::jsonb) as data`,
      [JSON.stringify({ occurrenceId, time })],
    );
    return rows[0]!.data;
  }

  async function stored(): Promise<string | null> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ t: string | null }>(
      `select to_char(departure_time, 'HH24:MI') as t from session_occurrences where id = $1`,
      [seed.occurrenceId],
    );
    return rows[0]!.t;
  }

  async function receiptStartWindow(): Promise<unknown> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ data: Record<string, unknown> }>(
      `select api_booking_receipt($1::jsonb) as data`,
      [JSON.stringify({ bookingId })],
    );
    return rows[0]!.data.startWindow;
  }

  it('lets staff set a departure time, which the guest’s receipt then prints', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    expect(await setTime('08:15')).toEqual({
      occurrenceId: seed.occurrenceId,
      departureTime: '08:15',
    });
    expect(await stored()).toBe('08:15');
    // The override wins over the activity's 09:00.
    expect(await receiptStartWindow()).toBe('08:15');
  });

  it("clears back to the tour's start time", async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    expect((await setTime(null)).departureTime).toBeNull();
    expect(await stored()).toBeNull();
    expect(await receiptStartWindow()).toBe('09:00');
  });

  it('refuses anything that is not a 24-hour HH:MM', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    for (const bad of ['8:15', '24:00', '09:60', 'nine', '09:00:00']) {
      await expect(setTime(bad)).rejects.toThrow(/invalid_request/);
    }
  });

  it('is staff-only', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(setTime('08:15')).rejects.toThrow(/forbidden/);
    await db.as(null);
    await expect(setTime('08:15')).rejects.toThrow(/permission denied|forbidden/);
  });

  it('refuses a departure in the past', async () => {
    await db.asOwner();
    const past = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() - interval '3 days', now() - interval '3 days' + interval '4 hours', 10)
         returning id`,
        [seed.optionId, seed.operatorId],
      )
    ).rows[0]!.id;
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(setTime('08:15', past)).rejects.toThrow(/occurrence_in_past/);
  });

  it('refuses a called-off departure', async () => {
    await db.asOwner();
    const off = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
         values ($1, $2, now() + interval '5 days', now() + interval '5 days 4 hours', 10, 'cancelled')
         returning id`,
        [seed.optionId, seed.operatorId],
      )
    ).rows[0]!.id;
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(setTime('08:15', off)).rejects.toThrow(/occurrence_cancelled/);
  });
});
