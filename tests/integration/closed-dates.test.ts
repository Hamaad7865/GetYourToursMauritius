import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { addDayKeys, mauritiusDay, slotStartUtc } from '@/lib/admin/closed-dates';

/**
 * Closed dates (Availability → Closed dates): a closed day is its slot at capacity 0, written by the
 * admin helpers in TypeScript. Proves, against the real schema + real SQL functions, that a closure
 * survives the cron's materialize_availability, blocks create_hold and the customer calendar, keeps
 * guests already booked, survives a capacity edit, and reopens to the option's normal pool.
 */
const STAFF = 'd7d7d7d7-d7d7-d7d7-d7d7-d7d7d7d7d7d7';

const hoisted = vi.hoisted(() => ({ shim: null as SupabaseShim | null }));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

const { closeDates, loadClosedDates, reopenDates, setDailyCapacity } =
  await import('@/lib/admin/availability-write');

describe('closed dates', () => {
  let db: TestDb;
  const today = mauritiusDay(new Date());

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [
      STAFF,
    ]);
    hoisted.shim = makeSupabaseShim(db.pg);
  });

  afterAll(async () => {
    await db.close();
  });

  const asStaff = () => db.as({ sub: STAFF, role: 'authenticated' });

  /** A published, priced tour with a 10-seat daily pool, its window materialised by the real SQL. */
  async function bookableTour(): Promise<{ activityId: string; optionId: string; slug: string }> {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    await db.pg.query(`delete from session_occurrences where activity_option_id = $1`, [
      seed.optionId,
    ]);
    await db.pg.query(`update activities set daily_capacity = 10 where id = $1`, [seed.activityId]);
    const { rows } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [seed.activityId],
    );
    await cron(seed.activityId);
    return { activityId: seed.activityId, optionId: seed.optionId, slug: rows[0]!.slug };
  }

  async function cron(activityId: string): Promise<void> {
    await asStaff();
    await db.pg.query(`select materialize_availability($1::jsonb)`, [
      JSON.stringify({ activityId }),
    ]);
  }

  async function capacities(optionId: string, from: string, to: string) {
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string; day: string; capacity: number }>(
      `select id, to_char(starts_at at time zone 'Indian/Mauritius', 'YYYY-MM-DD') as day, capacity
         from session_occurrences
        where activity_option_id = $1
          and (starts_at at time zone 'Indian/Mauritius')::date between $2::date and $3::date
        order by starts_at`,
      [optionId, from, to],
    );
    return rows;
  }

  it('closes a range, survives the cron, blocks new bookings, keeps existing guests', async () => {
    const { activityId, optionId, slug } = await bookableTour();
    const from = addDayKeys(today, 3);
    const to = addDayKeys(today, 5);

    // A guest already booked on the middle day must keep the booking.
    await db.asOwner();
    const middle = (await capacities(optionId, addDayKeys(today, 4), addDayKeys(today, 4)))[0]!;
    const { rows: bk } = await db.pg.query<{ id: string }>(
      `insert into bookings (customer_name, customer_email, status)
       values ('Keep Me', 'keep@example.com', 'confirmed') returning id`,
    );
    await db.pg.query(
      `insert into booking_items
         (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 2, 7500, 15000)`,
      [bk[0]!.id, middle.id, optionId],
    );

    await asStaff();
    const result = await closeDates(activityId, from, to);
    expect(result).toEqual({ from, to, days: 3 });

    await cron(activityId); // the five-minute cron must not reopen anything
    const rows = await capacities(optionId, addDayKeys(today, 2), addDayKeys(today, 6));
    expect(rows.map((r) => [r.day, r.capacity])).toEqual([
      [addDayKeys(today, 2), 10],
      [from, 0],
      [addDayKeys(today, 4), 0],
      [to, 0],
      [addDayKeys(today, 6), 10],
    ]);
    const { rows: kept } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from booking_items where session_occurrence_id = $1`,
      [middle.id],
    );
    expect(kept[0]!.n).toBe(1);

    await asStaff();
    expect(await loadClosedDates(activityId)).toEqual([{ from, to, days: 3 }]);

    // Customer calendar: 0 seats on closed days (the widget greys them out); create_hold refuses.
    await db.as(null);
    const { rows: avail } = await db.pg.query<{
      data: Array<{ occurrenceId: string; seatsLeft: number }>;
    }>(`select api_list_availability($1::jsonb) as data`, [
      JSON.stringify({ slug, from, to: addDayKeys(today, 6) }),
    ]);
    const seats = new Map(avail[0]!.data.map((s) => [s.occurrenceId, s.seatsLeft]));
    const closedIds = rows.filter((r) => r.capacity === 0).map((r) => r.id);
    for (const id of closedIds) expect(seats.get(id)).toBe(0);
    await db.asOwner();
    await expect(
      db.pg.query(`select create_hold($1, 1, 'closed-day-hold')`, [closedIds[0]]),
    ).rejects.toThrow(/insufficient_capacity/);
  });

  it('closes a day beyond the materialised window, and the cron leaves it closed', async () => {
    const { activityId, optionId } = await bookableTour();
    const far = addDayKeys(today, 250); // the cron materialises 185 days

    expect(await capacities(optionId, far, far)).toEqual([]);
    await asStaff();
    await closeDates(activityId, far, far);
    const [slot] = await capacities(optionId, far, far);
    expect(slot!.capacity).toBe(0);
    await db.asOwner();
    const { rows } = await db.pg.query<{ starts_at: Date }>(
      `select starts_at from session_occurrences where id = $1`,
      [slot!.id],
    );
    expect(rows[0]!.starts_at.toISOString()).toBe(slotStartUtc(far));

    await asStaff();
    await db.pg.query(`select materialize_availability($1::jsonb)`, [
      JSON.stringify({ activityId, days: 300 }),
    ]);
    expect(await capacities(optionId, far, far)).toEqual([slot]);
  });

  it('keeps closed dates through a capacity change, and reopens to the new pool', async () => {
    const { activityId, optionId } = await bookableTour();
    const day = addDayKeys(today, 7);

    await asStaff();
    await closeDates(activityId, day, day);
    await setDailyCapacity(activityId, 12);
    const around = await capacities(optionId, addDayKeys(day, -1), addDayKeys(day, 1));
    expect(around.map((r) => r.capacity)).toEqual([12, 0, 12]);

    await asStaff();
    await reopenDates(activityId, day, day);
    expect((await capacities(optionId, day, day))[0]!.capacity).toBe(12);
    await asStaff();
    expect(await loadClosedDates(activityId)).toEqual([]);
  });

  it('refuses a range that is backwards or already in the past', async () => {
    const { activityId } = await bookableTour();
    await asStaff();
    await expect(
      closeDates(activityId, addDayKeys(today, 3), addDayKeys(today, 2)),
    ).rejects.toThrow(/before the start/);
    await expect(
      closeDates(activityId, addDayKeys(today, -5), addDayKeys(today, -1)),
    ).rejects.toThrow(/in the past/);
  });
});
