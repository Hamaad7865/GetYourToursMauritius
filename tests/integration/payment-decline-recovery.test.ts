import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { makeSupabaseShim } from '../db/supabase-pglite';
import { reconcilePaymentEvent } from '@/lib/payments/reconcile';
import type { Database } from '@/lib/supabase/types';

/**
 * A declined card must not disable the money-recovery machinery.
 *
 * `bookings.payment_state` is a BOOKING-level column that append_payment_event used to write from
 * whichever payment ROW an event touched, and the per-row reducer latches to 'failed'
 * (`bool_or(type = 'failed')`). That statement is the only writer of the column in the whole schema,
 * so one declined transaction stamped the booking 'failed' permanently — and both recovery paths key
 * off exactly that column: api_pending_payment_checkouts (the webhook-less safety net) and
 * run_booking_maintenance (auto-expiry) each enumerated `payment_state = 'pending'`.
 *
 * The same latch forked the payment row: api_create_payment looked for a reusable row
 * `and status <> 'failed'`, so a retry minted a SECOND row — orphaning the checkout-reuse window and
 * the single-flight lease, which are columns on the skipped row, and leaving two independently
 * payable Peach sessions.
 *
 * Fixed in 20260902000000_money_path_recovery_fixes.
 */
const CUSTOMER = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';

describe('a declined payment keeps the booking recoverable', () => {
  let db: TestDb;
  let optionId: string;
  let operatorId: string;

  /** Book as the customer and open a payment. Returns the booking ref + the payment row id. */
  async function seed(key: string): Promise<{ ref: string; paymentId: string }> {
    await db.asOwner();
    const occId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '5 days', now() + interval '5 days 3 hours', 20) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId: occId,
      party: { Adult: 2 },
      customerName: 'Declined Customer',
      customerEmail: 'declined@example.com',
      source: 'web',
      idempotencyKey: `${key}-book`,
    });
    const payment = (
      await db.pg.query<{ data: { paymentId: string } }>(
        `select api_create_payment($1::jsonb) as data`,
        [JSON.stringify({ bookingRef: booking.ref, idempotencyKey: `${key}-pay` })],
      )
    ).rows[0]!.data;
    return { ref: booking.ref, paymentId: payment.paymentId };
  }

  /** The card is declined: Peach reports a failure, which reconcile appends to the ledger. */
  async function decline(paymentId: string, eventId: string): Promise<void> {
    await db.as({ role: 'service_role' });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'failed', $2::text, 0, now(), '{}'::jsonb)`,
      [paymentId, eventId],
    );
  }

  async function stampCheckout(paymentId: string, checkoutId: string): Promise<void> {
    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_record_payment_checkout($1::jsonb) as data`, [
      JSON.stringify({ paymentId, checkoutId }),
    ]);
  }

  async function bookingRow(ref: string): Promise<{ status: string; payment_state: string }> {
    await db.asOwner();
    return (
      await db.pg.query<{ status: string; payment_state: string }>(
        `select status::text, payment_state::text from bookings where ref = $1`,
        [ref],
      )
    ).rows[0]!;
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
         values ($1, 'decline-tour', 'activity', 'Decline Tour', 'Sightseeing tours', 'published') returning id`,
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

  it('the payment ROW still latches to failed — that part is per-row truth and is unchanged', async () => {
    const { paymentId } = await seed('row-latch');
    await decline(paymentId, 'evt-row-latch');
    await db.asOwner();
    const row = (
      await db.pg.query<{ status: string }>(`select status::text from payments where id = $1`, [
        paymentId,
      ])
    ).rows[0]!;
    expect(row.status).toBe('failed');
  });

  it('keeps the booking in the webhook-less reconcile sweep after a decline', async () => {
    const { ref, paymentId } = await seed('sweep-after-decline');
    await stampCheckout(paymentId, 'chk_declined');
    await decline(paymentId, 'evt-sweep-decline');

    await db.as({ role: 'service_role' });
    const enumerated = (
      await db.pg.query<{ data: Array<{ ref: string }> }>(
        `select api_pending_payment_checkouts('{}'::jsonb) as data`,
      )
    ).rows[0]!.data;
    // Before the fix this was empty: the booking had been stamped payment_state='failed', so the
    // safety net that re-queries Peach could never look at it again — and a later real payment whose
    // webhook was lost would sit unconfirmed with the money taken.
    expect(enumerated.map((r) => r.ref)).toContain(ref);
  });

  it('still auto-expires an abandoned booking after a decline', async () => {
    const { ref, paymentId } = await seed('expire-after-decline');
    await decline(paymentId, 'evt-expire-decline');
    await db.asOwner();
    await db.pg.query(
      `update bookings set created_at = now() - interval '3 hours' where ref = $1`,
      [ref],
    );

    await db.as({ role: 'service_role' });
    await db.pg.query(`select run_booking_maintenance('{"graceMinutes":30}'::jsonb) as data`);
    // Before the fix it never expired: it sat payment_pending forever with a live "Pay now"
    // affordance, including after the departure had run.
    expect((await bookingRow(ref)).status).toBe('expired');
  });

  it('never expires a booking whose money is real, however its projection reads', async () => {
    const { ref, paymentId } = await seed('expire-guard');
    await db.as({ role: 'service_role' });
    // A capture landed, then a stray failure event for the same row.
    await db.pg.query(
      `select append_payment_event($1::uuid, 'paid', 'evt-guard-paid', 10000, now(), '{}'::jsonb)`,
      [paymentId],
    );
    await db.asOwner();
    await db.pg.query(
      `update bookings set created_at = now() - interval '3 hours' where ref = $1`,
      [ref],
    );
    await db.as({ role: 'service_role' });
    await db.pg.query(`select run_booking_maintenance('{"graceMinutes":30}'::jsonb) as data`);
    expect((await bookingRow(ref)).status).not.toBe('expired');
  });

  it('reuses the declined payment row instead of minting a second payable session', async () => {
    const { ref, paymentId } = await seed('reuse-row');
    await stampCheckout(paymentId, 'chk_first');
    await decline(paymentId, 'evt-reuse');

    // The customer clicks "Complete payment" again.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const again = (
      await db.pg.query<{ data: { paymentId: string; existingCheckoutId: string | null } }>(
        `select api_create_payment($1::jsonb) as data`,
        [JSON.stringify({ bookingRef: ref, idempotencyKey: 'reuse-row-retry' })],
      )
    ).rows[0]!.data;

    // Same row — so the checkout-reuse window and the single-flight lease (both columns on it) still
    // apply. Before the fix this minted a second row and a second independently payable Peach
    // session, and a double charge across the two rows read as a clean 'paid'.
    expect(again.paymentId).toBe(paymentId);
    expect(again.existingCheckoutId).toBe('chk_first');

    await db.asOwner();
    const count = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from payments where booking_id = (select id from bookings where ref = $1)`,
        [ref],
      )
    ).rows[0]!.n;
    expect(Number(count)).toBe(1);
  });

  it('a successful retry on the reused row still confirms the booking', async () => {
    const { ref, paymentId } = await seed('retry-succeeds');
    await decline(paymentId, 'evt-retry-decline');
    await db.as({ role: 'service_role' });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'paid', 'evt-retry-paid', 10000, now(), '{}'::jsonb)`,
      [paymentId],
    );
    const row = await bookingRow(ref);
    // The reducer's `v_paid >= amount_minor` branch precedes the latched 'failed', so the capture wins.
    expect(row.payment_state).toBe('paid');
    expect(row.status).toBe('confirmed');
  });

  it('rolls the booking projection up across rows: one failed row does not mask a live one', async () => {
    const { ref, paymentId } = await seed('rollup');
    await decline(paymentId, 'evt-rollup');
    expect((await bookingRow(ref)).payment_state).toBe('failed');

    // A second row exists on legacy data (minted by the old fork) — the projection must follow the
    // live one, not whichever row an event happened to touch.
    await db.asOwner();
    const second = (
      await db.pg.query<{ id: string }>(
        `insert into payments (booking_id, idempotency_key, amount_minor)
         values ((select id from bookings where ref = $1), 'rollup-second', 10000) returning id`,
        [ref],
      )
    ).rows[0]!.id;
    await db.as({ role: 'service_role' });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'pending', 'evt-rollup-pending', 0, now(), '{}'::jsonb)`,
      [second],
    );
    expect((await bookingRow(ref)).payment_state).toBe('pending');

    // …and a later event on the FAILED row must not drag the booking back to 'failed'.
    await db.pg.query(
      `select append_payment_event($1::uuid, 'failed', 'evt-rollup-again', 0, now(), '{}'::jsonb)`,
      [paymentId],
    );
    expect((await bookingRow(ref)).payment_state).toBe('pending');
  });

  /**
   * reconcilePaymentEvent used to resolve the payment row by `booking_id` + newest-first, so on a
   * booking with more than one row (every booking the old fork touched) a late, retried or
   * out-of-order event was credited against the wrong row — corrupting a live payment's state and
   * measuring the settlement against the wrong pinned MUR charge.
   */
  it('credits the payment row that owns the checkout, not the booking’s newest row', async () => {
    const { ref, paymentId: older } = await seed('bind-owner');
    await stampCheckout(older, 'chk_older');

    // A second, newer row (the shape the old fork produced) with its own session.
    await db.asOwner();
    const newer = (
      await db.pg.query<{ id: string }>(
        `insert into payments (booking_id, idempotency_key, amount_minor, created_at)
         values ((select id from bookings where ref = $1), 'bind-newer', 10000, now() + interval '1 minute')
         returning id`,
        [ref],
      )
    ).rows[0]!.id;
    await stampCheckout(newer, 'chk_newer');

    // The reconcile paths all run service-role (webhook, cron sweep, /payments/sync).
    await db.as({ role: 'service_role' });
    const admin = makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>;
    await reconcilePaymentEvent(admin, {
      outcome: 'pending',
      bookingRef: ref,
      providerReference: 'evt-bind-older',
      providerCheckoutId: 'chk_older',
      amountMinor: 10000,
      currency: 'EUR',
      raw: {},
    });

    await db.asOwner();
    const owner = (
      await db.pg.query<{ payment_id: string }>(
        `select payment_id from payment_events where provider_event_id = 'evt-bind-older'`,
      )
    ).rows[0]!;
    expect(owner.payment_id).toBe(older);
    expect(owner.payment_id).not.toBe(newer);
  });

  it('falls back to the newest row when the provider reports no checkout id', async () => {
    const { ref, paymentId } = await seed('bind-fallback');
    await db.as({ role: 'service_role' });
    const admin = makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>;
    await reconcilePaymentEvent(admin, {
      outcome: 'pending',
      bookingRef: ref,
      providerReference: 'evt-bind-fallback',
      amountMinor: 10000,
      currency: 'EUR',
      raw: {},
    });
    await db.asOwner();
    const row = (
      await db.pg.query<{ payment_id: string }>(
        `select payment_id from payment_events where provider_event_id = 'evt-bind-fallback'`,
      )
    ).rows[0]!;
    expect(row.payment_id).toBe(paymentId);
  });
});
