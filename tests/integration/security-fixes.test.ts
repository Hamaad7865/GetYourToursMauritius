import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

const ITEMS = (label: string, qty: number) =>
  JSON.stringify([{ price_label: label, quantity: qty }]);

describe('security & integrity fixes', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('routes a late payment to refund_pending instead of overselling', async () => {
    await db.asOwner();
    const { occurrenceId } = await seedOccurrence(db, 1);

    // Customer A holds + books, then the hold expires before paying.
    const { rows: hA } = await db.pg.query<{ id: string }>(
      `select * from create_hold($1, 1, 'late-A')`,
      [occurrenceId],
    );
    const { rows: bA } = await db.pg.query<{ id: string }>(
      `select * from create_booking('bk-late-A', $1, 'A', 'a@x.com', null, 'web'::booking_source, $2::jsonb)`,
      [hA[0]!.id, ITEMS('Adult', 1)],
    );
    await db.pg.query(
      `update booking_holds set status = 'expired', expires_at = now() - interval '1 minute' where idempotency_key = 'late-A'`,
    );

    // Customer B grabs the freed seat and pays in time -> confirmed.
    const { rows: hB } = await db.pg.query<{ id: string }>(
      `select * from create_hold($1, 1, 'late-B')`,
      [occurrenceId],
    );
    const { rows: bB } = await db.pg.query<{ id: string }>(
      `select * from create_booking('bk-late-B', $1, 'B', 'b@x.com', null, 'web'::booking_source, $2::jsonb)`,
      [hB[0]!.id, ITEMS('Adult', 1)],
    );
    const { rows: pB } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor) values ($1, 'pay-late-B', 7500) returning id`,
      [bB[0]!.id],
    );
    await db.pg.query(
      `select * from append_payment_event($1, 'paid', 'evt-late-B', 7500, now(), '{}'::jsonb)`,
      [pB[0]!.id],
    );

    // A pays late: must NOT confirm (seat gone) -> refund_pending.
    const { rows: pA } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor) values ($1, 'pay-late-A', 7500) returning id`,
      [bA[0]!.id],
    );
    await db.pg.query(
      `select * from append_payment_event($1, 'paid', 'evt-late-A', 7500, now(), '{}'::jsonb)`,
      [pA[0]!.id],
    );

    const status = async (id: string) =>
      (await db.pg.query<{ status: string }>(`select status from bookings where id = $1`, [id]))
        .rows[0]!.status;
    expect(await status(bB[0]!.id)).toBe('confirmed');
    expect(await status(bA[0]!.id)).toBe('refund_pending');

    const { rows: confirmed } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from bookings b
       where b.status = 'confirmed'
         and exists (select 1 from booking_items bi where bi.booking_id = b.id and bi.session_occurrence_id = $1)`,
      [occurrenceId],
    );
    expect(confirmed[0]!.n).toBe(1); // capacity 1 respected — no oversell
  });

  it('rejects create_booking on a cancelled occurrence', async () => {
    await db.asOwner();
    const { occurrenceId } = await seedOccurrence(db, 5);
    const { rows: h } = await db.pg.query<{ id: string }>(
      `select * from create_hold($1, 1, 'cancel-h')`,
      [occurrenceId],
    );
    await db.pg.query(`update session_occurrences set status = 'cancelled' where id = $1`, [
      occurrenceId,
    ]);
    await expect(
      db.pg.query(
        `select * from create_booking('cancel-bk', $1, 'X', 'x@x.com', null, 'web'::booking_source, $2::jsonb)`,
        [h[0]!.id, ITEMS('Adult', 1)],
      ),
    ).rejects.toThrow(/occurrence_not_bookable/);
  });

  it('enforces per-tier max_guests across duplicate item lines (non-group activity)', async () => {
    await db.asOwner();
    const { occurrenceId, optionId } = await seedOccurrence(db, 10);
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests) values ($1, 'Private group', 30000, 2)`,
      [optionId],
    );
    const { rows: h } = await db.pg.query<{ id: string }>(
      `select * from create_hold($1, 4, 'dup-h')`,
      [occurrenceId],
    );
    const items = JSON.stringify([
      { price_label: 'Private group', quantity: 2 },
      { price_label: 'Private group', quantity: 2 },
    ]);
    await expect(
      db.pg.query(
        `select * from create_booking('dup-bk', $1, 'X', 'x@x.com', null, 'web'::booking_source, $2::jsonb)`,
        [h[0]!.id, items],
      ),
    ).rejects.toThrow(/exceeds_max_guests/);
  });

  it('charges per group when the activity opts into group pricing — the sightseeing-tour model', async () => {
    for (const [people, groups] of [
      [4, 1],
      [5, 2],
      [8, 2],
      [9, 3],
    ] as const) {
      await db.asOwner();
      const { occurrenceId, optionId } = await seedOccurrence(db, 50);
      // Opt this activity into per-group pricing.
      await db.pg.query(
        `update activities set pricing_mode = 'per_group' where id = (select activity_id from activity_options where id = $1)`,
        [optionId],
      );
      await db.pg.query(
        `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests) values ($1, 'Island group', 7000, 4)`,
        [optionId],
      );
      const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, $2, $3)`, [
        occurrenceId,
        people,
        `grp-${people}`,
      ]);
      const { rows: b } = await db.pg.query<{ total_minor: number | string }>(
        `select * from create_booking($1, $2, 'X', 'x@x.com', null, 'web'::booking_source, $3::jsonb)`,
        [`grp-bk-${people}`, h[0]!.id, JSON.stringify([{ price_label: 'Island group', quantity: people }])],
      );
      expect(Number(b[0]!.total_minor)).toBe(groups * 7000); // 4->70, 5->140, 8->140, 9->210
    }
  });

  it('books a non-"Adult" tour by its real tier label and rejects a hardcoded "Adult" party (Add-to-cart regression)', async () => {
    await db.asOwner();
    const { occurrenceId, optionId } = await seedOccurrence(db, 50);
    // A per-group tour whose only tier is labelled 'Private group' — like seed.sql's private-south-tour.
    // (Other live examples: 'Per transfer' on airport-transfer, 'Per day' on car-and-scooter-rental.)
    await db.pg.query(
      `update activities set pricing_mode = 'per_group' where id = (select activity_id from activity_options where id = $1)`,
      [optionId],
    );
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests) values ($1, 'Private group', 11000, 6)`,
      [optionId],
    );
    // Drop the default 'Adult' tier seedOccurrence adds, so 'Private group' is the ONLY (cheapest) tier.
    await db.pg.query(`delete from activity_option_prices where activity_option_id = $1 and label = 'Adult'`, [
      optionId,
    ]);

    // The fix: Add-to-cart sends the tour's REAL cheapest-tier label -> booking succeeds (flat group price).
    const { rows: hGood } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 4, 'lbl-good')`, [
      occurrenceId,
    ]);
    const { rows: b } = await db.pg.query<{ total_minor: number | string }>(
      `select * from create_booking('lbl-good-bk', $1, 'X', 'x@x.com', null, 'web'::booking_source, $2::jsonb)`,
      [hGood[0]!.id, JSON.stringify([{ price_label: 'Private group', quantity: 4 }])],
    );
    expect(Number(b[0]!.total_minor)).toBe(11000); // one group of up to 6, flat price

    // The old bug: Add-to-cart hardcoded { 'Adult': N }. The tour has no 'Adult' tier, so the server
    // rejects the booking at the payment step. (Asserted LAST so the rolled-back call can't affect the rest.)
    const { rows: hBad } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 4, 'lbl-bad')`, [
      occurrenceId,
    ]);
    await expect(
      db.pg.query(
        `select * from create_booking('lbl-bad-bk', $1, 'X', 'x@x.com', null, 'web'::booking_source, $2::jsonb)`,
        [hBad[0]!.id, JSON.stringify([{ price_label: 'Adult', quantity: 4 }])],
      ),
    ).rejects.toThrow(/unknown_price_tier/);
  });

  async function seedVehicle(capacity: number): Promise<{ occurrenceId: string; optionId: string }> {
    const { occurrenceId, optionId } = await seedOccurrence(db, capacity);
    await db.pg.query(
      `update activities set pricing_mode = 'vehicle' where id = (select activity_id from activity_options where id = $1)`,
      [optionId],
    );
    return { occurrenceId, optionId };
  }

  it('charges a flat price per vehicle bracket; SUV is the €85 upgrade ≤4', async () => {
    for (const [people, suv, expectMinor, vehicle] of [
      [1, false, 7000, 'Sedan'],
      [4, false, 7000, 'Sedan'],
      [4, true, 8500, 'SUV'],
      [5, false, 8500, 'Family car'],
      [6, false, 8500, 'Family car'],
      [7, false, 12500, 'Van'],
      [12, false, 12500, 'Van'],
      [14, false, 12500, 'Van'],
      [15, false, 22500, 'Coaster'],
      [25, false, 22500, 'Coaster'],
    ] as const) {
      await db.asOwner();
      const { occurrenceId } = await seedVehicle(10);
      const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 1, $2)`, [
        occurrenceId,
        `veh-${people}-${suv}`,
      ]);
      const { rows: b } = await db.pg.query<{ id: string; total_minor: number | string }>(
        `select * from create_booking($1, $2, 'X', 'x@x.com', null, 'web'::booking_source, $3::jsonb, $4)`,
        [`veh-bk-${people}-${suv}`, h[0]!.id, JSON.stringify([{ price_label: 'Vehicle', quantity: people }]), suv],
      );
      expect(Number(b[0]!.total_minor)).toBe(expectMinor);
      const { rows: item } = await db.pg.query<{
        quantity: number;
        pax: number;
        subtotal_minor: number | string;
        price_label: string;
      }>(`select quantity, pax, subtotal_minor, price_label from booking_items where booking_id = $1`, [b[0]!.id]);
      expect(item[0]!.quantity).toBe(1); // one vehicle slot
      expect(item[0]!.pax).toBe(people); // people on board
      expect(item[0]!.price_label).toBe(vehicle);
      expect(Number(item[0]!.subtotal_minor)).toBe(expectMinor);
    }
  });

  it('rejects a sightseeing party larger than 25', async () => {
    await db.asOwner();
    const { occurrenceId } = await seedVehicle(50);
    const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 1, 'veh-over')`, [
      occurrenceId,
    ]);
    await expect(
      db.pg.query(
        `select * from create_booking('veh-over-bk', $1, 'X', 'x@x.com', null, 'web'::booking_source, $2::jsonb, false)`,
        [h[0]!.id, JSON.stringify([{ price_label: 'Vehicle', quantity: 26 }])],
      ),
    ).rejects.toThrow(/exceeds_vehicle_capacity/);
  });

  it('counts vehicles, not people, against the day — two vehicles fill a capacity-2 day', async () => {
    await db.asOwner();
    const { occurrenceId } = await seedVehicle(2); // two vehicle slots
    for (const n of [1, 2]) {
      const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 1, $2)`, [
        occurrenceId,
        `cap-${n}`,
      ]);
      await db.pg.query(
        `select * from create_booking($1, $2, 'X', 'x@x.com', null, 'web'::booking_source, $3::jsonb, false)`,
        [`cap-bk-${n}`, h[0]!.id, JSON.stringify([{ price_label: 'Vehicle', quantity: 10 }])],
      );
    }
    // A third vehicle can't be held even though only "2" of the people-capacity is nominally used.
    await expect(db.pg.query(`select * from create_hold($1, 1, 'cap-3')`, [occurrenceId])).rejects.toThrow();
  });

  it('catalogue exposes the global vehicle pricing config (from €70) for vehicle mode', async () => {
    await db.asOwner();
    const { optionId } = await seedVehicle(10);
    const { rows: a } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = (select activity_id from activity_options where id = $1)`,
      [optionId],
    );
    const { rows } = await db.pg.query<{
      data: { pricingMode: string; fromPriceEur: number; vehiclePricing: unknown };
    }>(`select api_get_activity($1::jsonb) as data`, [JSON.stringify({ slug: a[0]!.slug })]);
    expect(rows[0]!.data.pricingMode).toBe('vehicle');
    expect(rows[0]!.data.fromPriceEur).toBe(70);
    expect(rows[0]!.data.vehiclePricing).toMatchObject({
      sedanEur: 70,
      suvEur: 85,
      familyEur: 85,
      vanEur: 125,
      coasterEur: 225,
      maxParty: 25,
    });
  });

  it('does not project a refund that arrives before any payment', async () => {
    await db.asOwner();
    const { occurrenceId } = await seedOccurrence(db, 5);
    const { rows: h } = await db.pg.query<{ id: string }>(
      `select * from create_hold($1, 1, 'pre-ref-h')`,
      [occurrenceId],
    );
    const { rows: b } = await db.pg.query<{ id: string }>(
      `select * from create_booking('pre-ref-bk', $1, 'X', 'x@x.com', null, 'web'::booking_source, $2::jsonb)`,
      [h[0]!.id, ITEMS('Adult', 1)],
    );
    const { rows: p } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor) values ($1, 'pre-ref-p', 7500) returning id`,
      [b[0]!.id],
    );
    const { rows: r } = await db.pg.query<{ status: string }>(
      `select * from append_payment_event($1, 'refunded', 'evt-early', 7500, now(), '{}'::jsonb)`,
      [p[0]!.id],
    );
    expect(r[0]!.status).toBe('pending'); // refund with no prior paid is not projected as refunded
  });

  it('handles large money amounts (bigint) without overflow', async () => {
    await db.asOwner();
    const { rows: op } = await db.pg.query<{ id: string }>(
      `insert into operators (name, slug) values ('Charter Co', 'charter-co') returning id`,
    );
    const { rows: act } = await db.pg.query<{ id: string }>(
      `insert into activities (operator_id, slug, title, category, status)
       values ($1, 'whole-boat-charter', 'Whole-Boat Charter', 'Catamaran cruises', 'published') returning id`,
      [op[0]!.id],
    );
    const { rows: opt } = await db.pg.query<{ id: string }>(
      `insert into activity_options (activity_id, name) values ($1, 'Whole boat') returning id`,
      [act[0]!.id],
    );
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Charter', 2000000000)`,
      [opt[0]!.id],
    );
    const { rows: occ } = await db.pg.query<{ id: string }>(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
       values ($1, $2, now() + interval '2 days', now() + interval '2 days 4 hours', 10) returning id`,
      [opt[0]!.id, op[0]!.id],
    );
    const { rows: h } = await db.pg.query<{ id: string }>(
      `select * from create_hold($1, 2, 'big-h')`,
      [occ[0]!.id],
    );
    const { rows: b } = await db.pg.query<{ total_minor: number | string }>(
      `select * from create_booking('big-bk', $1, 'X', 'x@x.com', null, 'web'::booking_source, $2::jsonb)`,
      [h[0]!.id, ITEMS('Charter', 2)],
    );
    expect(Number(b[0]!.total_minor)).toBe(4_000_000_000); // would overflow int (max ~2.15e9)
  });
});

describe('RLS hardening', () => {
  let db: TestDb;
  const CUSTOMER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('denies a customer directly inserting a booking (must go through the RPC)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      db.pg.query(
        `insert into bookings (user_id, customer_name, customer_email, status, payment_state, total_minor)
         values ($1, 'x', 'x@x.com', 'confirmed', 'paid', 0)`,
        [CUSTOMER],
      ),
    ).rejects.toThrow();
    await db.asOwner();
  });

  it('prevents a customer from escalating their own role (update is silently kept as customer)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await db.pg.query(`update profiles set role = 'admin' where id = $1`, [CUSTOMER]);
    await db.asOwner();
    const { rows } = await db.pg.query<{ role: string }>(
      `select role from profiles where id = $1`,
      [CUSTOMER],
    );
    expect(rows[0]!.role).toBe('customer');
  });

  it('forces a self-inserted profile to role customer', async () => {
    const uid = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [uid]);
    await db.as({ sub: uid, role: 'authenticated' });
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [uid]);
    await db.asOwner();
    const { rows } = await db.pg.query<{ role: string }>(
      `select role from profiles where id = $1`,
      [uid],
    );
    expect(rows[0]!.role).toBe('customer');
  });
});
