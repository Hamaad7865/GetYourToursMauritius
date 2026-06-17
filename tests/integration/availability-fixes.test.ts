import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

interface Slot {
  occurrenceId: string;
  status: string;
  startsAt: string;
}

describe('availability fixes (F5 reopen, F16 read/write consistency)', () => {
  let db: TestDb;
  let optionId: string;
  let operatorId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    operatorId = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Avail Co', 'avail-co') returning id`,
      )
    ).rows[0]!.id;
    const activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, title, category, status, daily_capacity, duration_minutes)
         values ($1, 'avail-tour', 'Avail Tour', 'Sightseeing tours', 'published', 6, 120) returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name, position) values ($1, 'Shared', 0) returning id`,
        [activityId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 5000)`,
      [optionId],
    );
    await db.as({ role: 'service_role' });
    await db.pg.query(`select materialize_availability($1::jsonb)`, [JSON.stringify({ activityId })]);
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  const list = async (): Promise<Slot[]> =>
    (
      await db.pg.query<{ data: Slot[] }>(`select api_list_availability($1::jsonb) as data`, [
        JSON.stringify({ slug: 'avail-tour' }),
      ])
    ).rows[0]!.data;

  it('F5: re-running materialize reopens a future day that was closed while booked', async () => {
    // Pick a future slot and close it, the way stopAvailability() closes a booked/held day.
    const future = (
      await db.pg.query<{ id: string }>(
        `select id from session_occurrences
         where activity_option_id = $1 and starts_at > now() + interval '2 days'
         order by starts_at limit 1`,
        [optionId],
      )
    ).rows[0]!.id;
    await db.pg.query(`update session_occurrences set status = 'closed' where id = $1`, [future]);

    // Re-enabling availability (admin re-clicks capacity → materialize) must restore it, not leave it
    // stranded as 'closed' forever (the unique (option, starts_at) constraint blocks a replacement).
    await db.as({ role: 'service_role' });
    await db.pg.query(`select materialize_availability($1::jsonb)`, [JSON.stringify({ activityId: null })]);
    await db.asOwner();
    const status = (
      await db.pg.query<{ status: string }>(`select status from session_occurrences where id = $1`, [
        future,
      ])
    ).rows[0]!.status;
    expect(status).toBe('open');
  });

  it('F16: the read never advertises a past/now slot (mirrors create_hold)', async () => {
    // A stale open slot in the past must not be offered, since create_hold would reject it.
    const past = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
         values ($1, $2, now() - interval '1 hour', now(), 6, 'open') returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;

    const slots = await list();
    expect(slots.find((s) => s.occurrenceId === past)).toBeUndefined();
    expect(slots.every((s) => new Date(s.startsAt).getTime() > Date.now())).toBe(true);

    // And create_hold agrees — it rejects the same past slot.
    await expect(
      db.pg.query(`select create_hold($1, 1, 'past-consistency')`, [past]),
    ).rejects.toThrow(/occurrence_in_past/);
  });

  it('blocks a non-staff signed-in customer from triggering materialize_availability', async () => {
    // A plain logged-in customer (no staff/admin profile) must not be able to drive the heavy,
    // full-catalogue materialization write. Only is_staff() or the service_role cron may.
    await db.as({ sub: 'cccccccc-cccc-cccc-cccc-cccccccccccc', role: 'authenticated' });
    await expect(db.pg.query(`select materialize_availability('{}'::jsonb)`)).rejects.toThrow(/forbidden/);
    await db.asOwner();
  });
});
