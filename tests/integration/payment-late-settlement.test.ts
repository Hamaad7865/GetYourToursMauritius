import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';

/**
 * Two money-path defects found by the 2026-08-01 sweep, both fixed in
 * 20260902000000_money_path_recovery_fixes.
 *
 *  F — a payment settling AFTER the departure was called off used to confirm the guest onto a
 *      cancelled occurrence. append_payment_event's confirm branch re-validated capacity but never
 *      looked at session_occurrences.status. The guest could not be put right afterwards either:
 *      api_weather_cancel_occurrence stamps only bookings that were already confirmed+paid when it
 *      ran and refuses to re-run on an occurrence it has already cancelled, so `disruption` stayed
 *      null — and that stamp is the only thing that opens the 24h bypass in api_cancel_booking and
 *      api_reschedule_booking. Charged, told "confirmed", locked out of both remedies.
 *
 *  G — api_book's transfer fare overrides re-priced the booking on an idempotency-key replay, unlike
 *      every other post-create mutation in that function, which is guarded.
 */
const CUSTOMER = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';

describe('a payment that settles after the departure was called off', () => {
  let db: TestDb;
  let optionId: string;
  let operatorId: string;

  async function seedConfirmable(key: string): Promise<{
    ref: string;
    paymentId: string;
    occurrenceId: string;
  }> {
    await db.asOwner();
    const occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '5 days', now() + interval '5 days 3 hours', 20) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      party: { Adult: 2 },
      customerName: 'Late Payer',
      customerEmail: 'late@example.com',
      source: 'web',
      idempotencyKey: `${key}-book`,
    });
    const payment = (
      await db.pg.query<{ data: { paymentId: string } }>(
        `select api_create_payment($1::jsonb) as data`,
        [JSON.stringify({ bookingRef: booking.ref, idempotencyKey: `${key}-pay` })],
      )
    ).rows[0]!.data;
    return { ref: booking.ref, paymentId: payment.paymentId, occurrenceId };
  }

  async function settle(paymentId: string, eventId: string): Promise<void> {
    await db.as({ role: 'service_role' });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'paid', $2::text, 10000, now(), '{}'::jsonb)`,
      [paymentId, eventId],
    );
  }

  async function statusOf(ref: string): Promise<string> {
    await db.asOwner();
    return (
      await db.pg.query<{ status: string }>(`select status::text from bookings where ref = $1`, [
        ref,
      ])
    ).rows[0]!.status;
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!
      .id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'late-tour', 'activity', 'Late Tour', 'Sightseeing tours', 'published') returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 5000)`,
      [optionId],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('confirms normally when the departure is still running', async () => {
    const { ref, paymentId } = await seedConfirmable('still-running');
    await settle(paymentId, 'evt-still-running');
    expect(await statusOf(ref)).toBe('confirmed');
  });

  it('routes the money back instead of confirming onto a cancelled departure', async () => {
    const { ref, paymentId, occurrenceId } = await seedConfirmable('called-off');
    await db.asOwner();
    await db.pg.query(`update session_occurrences set status = 'cancelled' where id = $1`, [
      occurrenceId,
    ]);

    await settle(paymentId, 'evt-called-off');

    // Before the fix this read 'confirmed' — booked onto a trip that is not running, with no
    // disruption stamp and therefore no route to a refund or a reschedule.
    expect(await statusOf(ref)).toBe('refund_pending');
  });

  it('still records the money on the ledger when it routes to refund_pending', async () => {
    const { ref, paymentId, occurrenceId } = await seedConfirmable('called-off-ledger');
    await db.asOwner();
    await db.pg.query(`update session_occurrences set status = 'cancelled' where id = $1`, [
      occurrenceId,
    ]);
    await settle(paymentId, 'evt-called-off-ledger');

    await db.asOwner();
    const row = (
      await db.pg.query<{ payment_state: string; paid_minor: string }>(
        `select b.payment_state::text, p.paid_minor
           from bookings b join payments p on p.booking_id = b.id
          where b.ref = $1`,
        [ref],
      )
    ).rows[0]!;
    // The capture is real and must stay visible — refund_pending is a work item, not a denial.
    expect(row.payment_state).toBe('paid');
    expect(Number(row.paid_minor)).toBe(10000);
  });
});

describe('api_book: the transfer fare override is replay-safe', () => {
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
    // Same shape as tests/integration/airport-transfer-booking.test.ts: the seeded transfer product
    // lives in seed.sql, not in the migrations the PGlite harness applies.
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
  });

  afterAll(async () => {
    await db.close();
  });

  it('prices the transfer on first create, then refuses to re-price it once payment has started', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const payload = {
      occurrenceId,
      expectedSlug: 'airport-transfer',
      party: { Transfer: 2 },
      dropoffSlug: 'shandrani-beachcomber',
      tripDirection: 'arrival' as const,
      customerName: 'Replay Tester',
      customerEmail: 'replay@example.com',
      source: 'web' as const,
      idempotencyKey: 'replay-guard-1234',
    };
    const first = await apiBook<{ ref: string; totalEur: number }>(db, payload);
    expect(first.totalEur).toBe(35); // Zone 2 standard car, one leg

    // The customer starts paying — this is what makes the total load-bearing: api_create_payment pins
    // a MUR charge against it and Peach mints a session for that amount.
    await db.pg.query(`select api_create_payment($1::jsonb) as data`, [
      JSON.stringify({ bookingRef: first.ref, idempotencyKey: 'replay-guard-pay' }),
    ]);

    // A replay of the SAME idempotency key, now claiming a return trip to a different zone.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const replay = await apiBook<{ ref: string; totalEur: number }>(db, {
      ...payload,
      tripDirection: 'return' as const,
      dropoffSlug: 'anantara-iko-mauritius',
    });

    // create_booking returns the existing row, so it is the same booking — and its price must not
    // have moved out from under the pinned charge and the live Peach session.
    expect(replay.ref).toBe(first.ref);
    expect(replay.totalEur).toBe(35);

    await db.asOwner();
    const total = (
      await db.pg.query<{ total_minor: string }>(
        `select total_minor from bookings where ref = $1`,
        [first.ref],
      )
    ).rows[0]!.total_minor;
    expect(Number(total)).toBe(3500);
  });
});
