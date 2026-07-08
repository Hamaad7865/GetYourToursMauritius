import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence, seedPrivateOption, type SeedResult } from '../db/seed';

/**
 * Private option with its own capacity pool (migration 20260801000000): a per_person activity keeps its
 * shared/standard option (seats/day) and gains a PRIVATE option priced base+per-extra-head, whose pool
 * counts TRIPS per day — every private booking consumes exactly ONE capacity unit (the vehicle-mode
 * contract: hold quantity 1, one booking_items row with quantity 1 + the headcount in pax), so
 * used_capacity / create_hold / append_payment_event enforce the independent pool unchanged.
 *
 * Config used throughout: base €90 covers up to 4 guests, €25 per extra guest, max 8, 1 trip/day.
 */
const STAFF = 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7';
const CFG = { baseMinor: 9000, included: 4, extraMinor: 2500, maxGuests: 8, tripsPerDay: 1 };

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [JSON.stringify(params)]);
  return rows[0]!.data;
}

async function usedCapacity(db: TestDb, occurrenceId: string): Promise<number> {
  const { rows } = await db.pg.query<{ u: number }>(`select used_capacity($1) as u`, [occurrenceId]);
  return Number(rows[0]!.u);
}

async function activitySlug(db: TestDb, activityId: string): Promise<string> {
  const { rows } = await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [activityId]);
  return rows[0]!.slug;
}

async function bookPrivate(
  db: TestDb,
  seed: SeedResult,
  occurrenceId: string,
  guests: number,
  key: string,
): Promise<{ ref: string; totalEur: number }> {
  return call<{ ref: string; totalEur: number }>(db, 'api_book', {
    occurrenceId,
    expectedSlug: await activitySlug(db, seed.activityId),
    party: { 'Private charter': guests },
    customerName: 'Private Tester',
    customerEmail: 'private@example.com',
    source: 'web',
    idempotencyKey: key,
  });
}

describe('private option (own trips-per-day pool + base+per-head pricing)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [STAFF]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('api_get_activity ships the private config on the option; fromPrice stays the shared tier', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    await seedPrivateOption(db, seed, CFG);
    const data = await call<{
      fromPriceEur: number;
      options: Array<{
        name: string;
        privateBaseEur: number | null;
        privateIncluded: number | null;
        privateExtraEur: number | null;
        privateMaxGuests: number | null;
        prices: unknown[];
      }>;
    }>(db, 'api_get_activity', { slug: await activitySlug(db, seed.activityId) });

    const priv = data.options.find((o) => o.name === 'Private charter')!;
    expect(priv).toMatchObject({ privateBaseEur: 90, privateIncluded: 4, privateExtraEur: 25, privateMaxGuests: 8 });
    expect(priv.prices).toEqual([]);
    const shared = data.options.find((o) => o.name === 'Shared')!;
    expect(shared.privateBaseEur).toBeNull();
    // The private base never feeds the listing "From" price — that stays the shared Adult tier.
    expect(data.fromPriceEur).toBe(75);
  });

  it('api_search_activities shows a private-only activity’s base as fromPrice (not "On request")', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    await seedPrivateOption(db, seed, CFG);
    // Make it private-only: drop the shared option's tier so only the private base remains.
    await db.pg.query(`delete from activity_option_prices where activity_option_id = $1`, [seed.optionId]);
    const slug = await activitySlug(db, seed.activityId);
    const res = await call<{ items: Array<{ slug: string; fromPriceEur: number | null }> }>(db, 'api_search_activities', {
      category: 'Catamaran cruises',
      pageSize: 200,
    });
    expect(res.items.find((i) => i.slug === slug)?.fromPriceEur).toBe(90); // the €90 base, not null
  });

  it('api_search_activities keeps the shared tier as fromPrice when a standard option also exists', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10); // Shared 'Adult' €75
    await seedPrivateOption(db, seed, CFG); // + Private base €90
    const slug = await activitySlug(db, seed.activityId);
    const res = await call<{ items: Array<{ slug: string; fromPriceEur: number | null }> }>(db, 'api_search_activities', {
      category: 'Catamaran cruises',
      pageSize: 200,
    });
    expect(res.items.find((i) => i.slug === slug)?.fromPriceEur).toBe(75); // per-person entry wins, not €90
  });

  it('prices the base for 1..included guests and adds the per-head extra above it', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    // 3 trips/day so the three bookings below all fit on the same occurrence.
    const priv = await seedPrivateOption(db, seed, { ...CFG, tripsPerDay: 3 });

    expect((await bookPrivate(db, seed, priv.occurrenceId, 1, 'priv-n1')).totalEur).toBe(90);
    expect((await bookPrivate(db, seed, priv.occurrenceId, 4, 'priv-n4')).totalEur).toBe(90);
    expect((await bookPrivate(db, seed, priv.occurrenceId, 6, 'priv-n6')).totalEur).toBe(140); // 90 + 2×25
  });

  it('rejects a party above private_max_guests', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    const priv = await seedPrivateOption(db, seed, CFG);
    await expect(bookPrivate(db, seed, priv.occurrenceId, 9, 'priv-over')).rejects.toThrow(/exceeds_max_guests/);
  });

  it('a private booking consumes ONE trip regardless of group size, as a single pax-carrying item', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    const priv = await seedPrivateOption(db, seed, CFG);

    const booking = await bookPrivate(db, seed, priv.occurrenceId, 6, 'priv-pool');
    expect(booking.totalEur).toBe(140);

    // 6 guests → 1 capacity unit (trips-counted), NOT 6.
    expect(await usedCapacity(db, priv.occurrenceId)).toBe(1);
    // …and the shared option's pool is untouched (independent pools).
    expect(await usedCapacity(db, seed.occurrenceId)).toBe(0);

    // One line item: quantity 1, headcount in pax, subtotal = the flat total.
    const { rows: items } = await db.pg.query<{ price_label: string; quantity: number; pax: number; subtotal_minor: number }>(
      `select bi.price_label, bi.quantity, bi.pax, bi.subtotal_minor
         from booking_items bi join bookings b on b.id = bi.booking_id
        where b.idempotency_key = 'priv-pool'`,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ price_label: 'Private charter', quantity: 1, pax: 6, subtotal_minor: 14000 });

    // seatsLeft (trips left) hits 0 for the private occurrence only.
    const avail = await call<Array<{ occurrenceId: string; seatsLeft: number }>>(db, 'api_list_availability', {
      slug: await activitySlug(db, seed.activityId),
    });
    expect(avail.find((s) => s.occurrenceId === priv.occurrenceId)?.seatsLeft).toBe(0);
    expect(avail.find((s) => s.occurrenceId === seed.occurrenceId)?.seatsLeft).toBe(10);
  });

  it('a second private booking the same day is rejected at 1 trip/day; the shared pool still books', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    const priv = await seedPrivateOption(db, seed, CFG);

    await bookPrivate(db, seed, priv.occurrenceId, 2, 'priv-first');
    await expect(bookPrivate(db, seed, priv.occurrenceId, 2, 'priv-second')).rejects.toThrow(/insufficient_capacity/);

    // Independent pools the other way round: the shared option still takes a normal booking.
    const shared = await call<{ totalEur: number }>(db, 'api_book', {
      occurrenceId: seed.occurrenceId,
      expectedSlug: await activitySlug(db, seed.activityId),
      party: { Adult: 3 },
      customerName: 'Shared Tester',
      customerEmail: 'shared@example.com',
      source: 'web',
      idempotencyKey: 'shared-after-private',
    });
    expect(shared.totalEur).toBe(225);
    expect(await usedCapacity(db, seed.occurrenceId)).toBe(3);
  });

  it('api_create_hold reserves ONE unit for a private option no matter the party size', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    const priv = await seedPrivateOption(db, seed, CFG);

    const hold = await call<{ quantity: number }>(db, 'api_create_hold', {
      occurrenceId: priv.occurrenceId,
      idempotencyKey: 'priv-hold',
      expectedSlug: await activitySlug(db, seed.activityId),
      people: 6,
    });
    expect(hold.quantity).toBe(1);
    expect(await usedCapacity(db, priv.occurrenceId)).toBe(1);
  });

  it('payment re-check confirms a clean private booking and routes a raced oversell to refund_pending', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    const priv = await seedPrivateOption(db, seed, CFG);

    // Booking A (6 guests, €140) — then its hold "expires" mid-checkout, freeing the 1-trip pool.
    await bookPrivate(db, seed, priv.occurrenceId, 6, 'priv-race-a');
    await db.pg.query(
      `update booking_holds h set expires_at = now() - interval '1 minute'
        from bookings b where b.id = h.booking_id and b.idempotency_key = 'priv-race-a'`,
    );

    // Booking B (2 guests, €90) grabs the freed trip and PAYS FIRST → confirmed.
    await bookPrivate(db, seed, priv.occurrenceId, 2, 'priv-race-b');
    const pay = async (key: string, amount: number, evt: string) => {
      const { rows: b } = await db.pg.query<{ id: string }>(`select id from bookings where idempotency_key = $1`, [key]);
      const { rows: p } = await db.pg.query<{ id: string }>(
        `insert into payments (booking_id, idempotency_key, amount_minor) values ($1, $2, $3) returning id`,
        [b[0]!.id, `pay-${key}`, amount],
      );
      await db.pg.query(`select * from append_payment_event($1, $2, $3, $4, $5::timestamptz, $6::jsonb)`, [
        p[0]!.id, 'paid', evt, amount, new Date().toISOString(), '{}',
      ]);
      const { rows: st } = await db.pg.query<{ status: string }>(`select status from bookings where id = $1`, [b[0]!.id]);
      return st[0]!.status;
    };

    expect(await pay('priv-race-b', 9000, 'evt-b')).toBe('confirmed');
    // A pays second: 1 needed > 1 cap − 1 confirmed → oversold → refund_pending (money captured, seat gone).
    expect(await pay('priv-race-a', 14000, 'evt-a')).toBe('refund_pending');
    expect(await usedCapacity(db, priv.occurrenceId)).toBe(1);
  });

  it('materialize_availability gives each option its own capacity and materializes a tier-less private option', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    const priv = await seedPrivateOption(db, seed, { ...CFG, tripsPerDay: 2 });
    await db.pg.query(`update activities set daily_capacity = 5 where id = $1`, [seed.activityId]);

    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`select materialize_availability($1::jsonb)`, [JSON.stringify({ activityId: seed.activityId })]);
    await db.asOwner();

    const counts = async (optionId: string, capacity: number) => {
      const { rows } = await db.pg.query<{ n: number }>(
        `select count(*)::int as n from session_occurrences where activity_option_id = $1 and capacity = $2`,
        [optionId, capacity],
      );
      return rows[0]!.n;
    };
    // Shared days materialized at the ACTIVITY capacity, private days at the OPTION capacity —
    // the private option has NO price tiers yet still got its window.
    expect(await counts(seed.optionId, 5)).toBeGreaterThan(100);
    expect(await counts(priv.optionId, 2)).toBeGreaterThan(100);
  });

  it('materialize_availability stays dark while the activity master switch is off', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10); // activities.daily_capacity stays NULL
    await seedPrivateOption(db, seed, CFG); // option-level capacity set, but the master switch is off

    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`select materialize_availability($1::jsonb)`, [JSON.stringify({ activityId: seed.activityId })]);
    await db.asOwner();

    // Only the two manually-seeded occurrences exist — an option-level capacity alone never re-lights it.
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from session_occurrences so
        join activity_options o on o.id = so.activity_option_id
       where o.activity_id = $1`,
      [seed.activityId],
    );
    expect(rows[0]!.n).toBe(2);
  });

  it('set_daily_capacity_atomic: activity path skips option pools; optionId targets one; inherit clears', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    const priv = await seedPrivateOption(db, seed, CFG); // option daily_capacity = 1

    const occCapacity = async (occurrenceId: string) => {
      const { rows } = await db.pg.query<{ c: number }>(`select capacity as c from session_occurrences where id = $1`, [occurrenceId]);
      return Number(rows[0]!.c);
    };

    await db.as({ sub: STAFF, role: 'authenticated' });
    // Activity-wide: shared occurrences take 12; the private pool (option-scoped) is untouched.
    await db.pg.query(`select set_daily_capacity_atomic($1::jsonb)`, [
      JSON.stringify({ activityId: seed.activityId, capacity: 12 }),
    ]);
    await db.asOwner();
    expect(await occCapacity(seed.occurrenceId)).toBe(12);
    expect(await occCapacity(priv.occurrenceId)).toBe(1);

    // Option-scoped: only the private option moves.
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`select set_daily_capacity_atomic($1::jsonb)`, [
      JSON.stringify({ activityId: seed.activityId, optionId: priv.optionId, capacity: 3 }),
    ]);
    await db.asOwner();
    expect(await occCapacity(priv.occurrenceId)).toBe(3);
    expect(await occCapacity(seed.occurrenceId)).toBe(12);
    const { rows: optCap } = await db.pg.query<{ daily_capacity: number }>(
      `select daily_capacity from activity_options where id = $1`,
      [priv.optionId],
    );
    expect(optCap[0]!.daily_capacity).toBe(3);

    // Inherit: the override clears and future private occurrences restamp from the activity value.
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`select set_daily_capacity_atomic($1::jsonb)`, [
      JSON.stringify({ activityId: seed.activityId, optionId: priv.optionId, inherit: true }),
    ]);
    await db.asOwner();
    expect(await occCapacity(priv.occurrenceId)).toBe(12);
    const { rows: cleared } = await db.pg.query<{ daily_capacity: number | null }>(
      `select daily_capacity from activity_options where id = $1`,
      [priv.optionId],
    );
    expect(cleared[0]!.daily_capacity).toBeNull();
  });
});
