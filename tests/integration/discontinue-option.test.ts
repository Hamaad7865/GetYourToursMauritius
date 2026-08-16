import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';
import { apiBook } from '../db/book';

/**
 * Discontinue a booking option (20261004000000). Setting activity_options.status = 'archived'
 * soft-retires ONE option: hidden from customers, no new dates, existing bookings kept.
 *   * set_option_status_atomic('archived') deletes the empty future slots, closes the referenced ones;
 *   * api_get_activity omits archived options from the option list AND the from-price;
 *   * materialize_availability never (re)generates dates for an archived option;
 *   * reinstate ('active') re-materialises and re-lists it.
 * A booked option can never be hard-deleted — this is how you retire it while keeping its record.
 */
const STAFF = 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2';

describe('discontinue a booking option', () => {
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

  async function materialize(activityId: string): Promise<void> {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`select materialize_availability($1::jsonb)`, [
      JSON.stringify({ activityId }),
    ]);
    await db.asOwner();
  }

  async function setStatus(optionId: string, status: string): Promise<void> {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`select set_option_status_atomic($1::jsonb)`, [
      JSON.stringify({ optionId, status }),
    ]);
    await db.asOwner();
  }

  async function getActivity(slug: string): Promise<{
    options: Array<{ id: string; name: string }>;
    fromPriceEur: number | null;
  }> {
    const { rows } = await db.pg.query<{
      data: { options: Array<{ id: string; name: string }>; fromPriceEur: number | null };
    }>(`select api_get_activity($1::jsonb) as data`, [JSON.stringify({ slug })]);
    return rows[0]!.data;
  }

  async function futureSlots(optionId: string): Promise<{ open: number; closed: number }> {
    const { rows } = await db.pg.query<{ status: string; n: number }>(
      `select status, count(*)::int as n from session_occurrences
        where activity_option_id = $1 and starts_at >= now()
        group by status`,
      [optionId],
    );
    const open = rows.find((r) => r.status === 'open')?.n ?? 0;
    const closed = rows.find((r) => r.status === 'closed')?.n ?? 0;
    return { open, closed };
  }

  it('archives an option: hides it, deletes empty dates, keeps a booked one — reinstate restores it', async () => {
    await db.asOwner();
    // Activity with TWO priced options: A "Shared" €75 (stays), B "Sunset dinner" €50 (archived).
    const seed = await seedOccurrence(db, 10); // option A = seed.optionId, price €75
    await db.pg.query(`delete from session_occurrences where activity_option_id = $1`, [
      seed.optionId,
    ]);
    await db.pg.query(`update activities set daily_capacity = 10 where id = $1`, [seed.activityId]);
    const { rows: bopt } = await db.pg.query<{ id: string }>(
      `insert into activity_options (activity_id, name) values ($1, 'Sunset dinner') returning id`,
      [seed.activityId],
    );
    const optionB = bopt[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 5000)`,
      [optionB],
    );
    const { rows: srow } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [seed.activityId],
    );
    const slug = srow[0]!.slug;

    await materialize(seed.activityId); // both options get ~185 days of slots

    // Baseline: both options listed, from-price = the cheaper (€50, option B).
    let dto = await getActivity(slug);
    expect(dto.options.map((o) => o.id).sort()).toEqual([seed.optionId, optionB].sort());
    expect(dto.fromPriceEur).toBe(50);

    // A real booking lands on a future B slot — it must survive archiving as a closed slot.
    const { rows: fut } = await db.pg.query<{ id: string }>(
      `select id from session_occurrences
        where activity_option_id = $1 and starts_at >= now() + interval '1 day'
        order by starts_at limit 1`,
      [optionB],
    );
    await db.as(null);
    await apiBook(db, {
      occurrenceId: fut[0]!.id,
      expectedSlug: slug,
      party: { Adult: 2 },
      customerName: 'Keep Me',
      customerEmail: 'keep@example.com',
      source: 'web',
      idempotencyKey: 'discontinue-keep',
    });
    await db.asOwner();

    // Discontinue option B.
    await setStatus(optionB, 'archived');

    // B is archived; its empty future slots are gone; the booked one is kept as 'closed'.
    const { rows: st } = await db.pg.query<{ status: string }>(
      `select status from activity_options where id = $1`,
      [optionB],
    );
    expect(st[0]!.status).toBe('archived');
    const bSlots = await futureSlots(optionB);
    expect(bSlots.open).toBe(0); // no bookable dates left
    expect(bSlots.closed).toBe(1); // the booked slot, kept
    // Option A is untouched and still bookable.
    expect((await futureSlots(seed.optionId)).open).toBeGreaterThan(0);

    // Customer view: B is gone from the option list AND the from-price (now €75, option A only).
    dto = await getActivity(slug);
    expect(dto.options.map((o) => o.id)).toEqual([seed.optionId]);
    expect(dto.fromPriceEur).toBe(75);

    // materialize_availability does NOT regenerate B while archived.
    await materialize(seed.activityId);
    expect((await futureSlots(optionB)).open).toBe(0);

    // Reinstate B → dates come back and it is listed + cheapest again.
    await setStatus(optionB, 'active');
    expect((await futureSlots(optionB)).open).toBeGreaterThan(0);
    dto = await getActivity(slug);
    expect(dto.options.map((o) => o.id).sort()).toEqual([seed.optionId, optionB].sort());
    expect(dto.fromPriceEur).toBe(50);
  });

  it('rejects an unknown status', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      db.pg.query(`select set_option_status_atomic($1::jsonb)`, [
        JSON.stringify({ optionId: seed.optionId, status: 'deleted' }),
      ]),
    ).rejects.toThrow(/invalid_request/);
    await db.asOwner();
  });
});
