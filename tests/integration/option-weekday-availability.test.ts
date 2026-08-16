import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

/**
 * Per-option day-of-week availability (20261003000000). `activity_options.closed_weekdays` lists the
 * ISO weekdays (Mon=1 … Sun=7) an option does NOT run — e.g. the sunset catamaran is off on Sundays
 * and Mondays. Enforced at the single generation point:
 *   * materialize_availability never creates (or reopens) a slot on a closed weekday;
 *   * set_option_weekdays_atomic writes the setting and reconciles the ~6 months already materialised —
 *     closing the referenced future slots, deleting the empty ones, then re-materialising to refill any
 *     weekday switched back on.
 * Because closed-day slots end up absent or `closed`, every read (api_list_availability) and the booking
 * path (create_hold rejects a missing/closed slot) are correct with no change to them.
 */
const STAFF = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
const SUN_MON = [7, 1]; // ISO: Sunday=7, Monday=1

/** ISO weekday (Mauritius-local) of each of an option's occurrences. */
async function occurrenceWeekdays(
  db: TestDb,
  optionId: string,
  where = '',
): Promise<Array<{ dow: number; status: string; future: boolean }>> {
  const { rows } = await db.pg.query<{ dow: number; status: string; future: boolean }>(
    `select extract(isodow from (starts_at at time zone 'Indian/Mauritius'))::int as dow,
            status,
            starts_at >= now() as future
       from session_occurrences
      where activity_option_id = $1 ${where}
      order by starts_at`,
    [optionId],
  );
  return rows;
}

describe('per-option day-of-week availability', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [
      STAFF,
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  /** A clean, published, priced, capacity-set option with no occurrences yet. */
  async function freshOption(): Promise<{ activityId: string; optionId: string; slug: string }> {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    // seedOccurrence drops one occurrence in; clear it so each test materialises from scratch.
    await db.pg.query(`delete from session_occurrences where activity_option_id = $1`, [
      seed.optionId,
    ]);
    await db.pg.query(`update activities set daily_capacity = 10 where id = $1`, [seed.activityId]);
    const { rows } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [seed.activityId],
    );
    return { activityId: seed.activityId, optionId: seed.optionId, slug: rows[0]!.slug };
  }

  async function materialize(activityId: string): Promise<void> {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`select materialize_availability($1::jsonb)`, [
      JSON.stringify({ activityId }),
    ]);
    await db.asOwner();
  }

  async function setWeekdays(optionId: string, closedWeekdays: number[]): Promise<void> {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`select set_option_weekdays_atomic($1::jsonb)`, [
      JSON.stringify({ optionId, closedWeekdays }),
    ]);
    await db.asOwner();
  }

  it('materialize_availability never creates a slot on a closed weekday', async () => {
    const { activityId, optionId } = await freshOption();
    await db.pg.query(`update activity_options set closed_weekdays = '{1,7}' where id = $1`, [
      optionId,
    ]);

    await materialize(activityId);

    const occ = await occurrenceWeekdays(db, optionId);
    expect(occ.length).toBeGreaterThan(0); // it DID materialise the open days
    expect(occ.some((o) => SUN_MON.includes(o.dow))).toBe(false); // …but none on Sun/Mon
  });

  it('set_option_weekdays_atomic deletes empty closed-weekday slots, keeps referenced ones (closed)', async () => {
    const { activityId, optionId } = await freshOption();
    await materialize(activityId); // every day open

    // A confirmed booking sits on the soonest future Sunday — it must survive as a CLOSED slot.
    const { rows: sun } = await db.pg.query<{ id: string }>(
      `select id from session_occurrences
        where activity_option_id = $1
          and extract(isodow from (starts_at at time zone 'Indian/Mauritius'))::int = 7
          and starts_at >= now() + interval '1 day'
        order by starts_at limit 1`,
      [optionId],
    );
    const bookedSunday = sun[0]!.id;
    const { rows: bk } = await db.pg.query<{ id: string }>(
      `insert into bookings (customer_name, customer_email, status)
       values ('Keep Me', 'keep@example.com', 'confirmed') returning id`,
    );
    await db.pg.query(
      `insert into booking_items
         (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 2, 7500, 15000)`,
      [bk[0]!.id, bookedSunday, optionId],
    );

    await setWeekdays(optionId, SUN_MON);

    const occ = await occurrenceWeekdays(db, optionId);
    const futureClosedDow = occ.filter((o) => o.future && SUN_MON.includes(o.dow));
    // Only the booked Sunday remains on a closed weekday, and it is now closed (not deleted).
    expect(futureClosedDow).toHaveLength(1);
    expect(futureClosedDow[0]!.status).toBe('closed');
    const { rows: kept } = await db.pg.query<{ status: string }>(
      `select status from session_occurrences where id = $1`,
      [bookedSunday],
    );
    expect(kept[0]!.status).toBe('closed');
    // Other weekdays are untouched and still open.
    expect(occ.some((o) => o.future && !SUN_MON.includes(o.dow) && o.status === 'open')).toBe(true);

    // Switching the weekdays back on re-materialises Sun/Mon.
    await setWeekdays(optionId, []);
    const reopened = await occurrenceWeekdays(db, optionId);
    const openSunMon = reopened.filter(
      (o) => o.future && SUN_MON.includes(o.dow) && o.status === 'open',
    );
    expect(openSunMon.length).toBeGreaterThan(1);
  });

  it('api_list_availability returns no closed-weekday slots', async () => {
    const { activityId, optionId, slug } = await freshOption();
    await db.pg.query(`update activity_options set closed_weekdays = '{1,7}' where id = $1`, [
      optionId,
    ]);
    await materialize(activityId);

    const { rows } = await db.pg.query<{ data: Array<{ startsAt: string }> }>(
      `select api_list_availability($1::jsonb) as data`,
      [JSON.stringify({ slug })],
    );
    const slots = rows[0]!.data;
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const dow = new Date(s.startsAt).getUTCDay(); // stored noon Mauritius (UTC+4) → same calendar day in UTC
      const iso = dow === 0 ? 7 : dow;
      expect(SUN_MON.includes(iso)).toBe(false);
    }
  });
});
