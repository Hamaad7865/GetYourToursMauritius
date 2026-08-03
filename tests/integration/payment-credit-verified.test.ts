import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { makeSupabaseShim } from '../db/supabase-pglite';
import type { Database } from '@/lib/supabase/types';
import type { PaymentEvent } from '@/lib/payments/types';
import { reconcilePaymentEvent } from '@/lib/payments/reconcile';

/**
 * reconcile must report what the LEDGER did, not what the provider said.
 *
 * `append_payment_event` absorbs its ledger insert with
 *   `insert into payment_events … on conflict (payment_id, provider_event_id, type) do nothing`
 * so an event colliding with one already on file writes nothing, credits nothing, and returns with a
 * perfectly clean error channel. reconcile used to derive `confirmed` from the provider's outcome
 * string alone, which meant a discarded settlement reported a confirmed booking over an empty
 * ledger — the booking stayed payment_pending, the expiry sweep released it, and the seat was resold
 * with the customer's money taken. That is not a hypothetical: it is the 2026-07-31 Peach incident,
 * where the Successful notification reused the Pending's transaction id.
 *
 * The dedup key was widened to include the event type, which fixes THAT cause. This test guards the
 * other half — that a shortfall is caught whatever the cause — by occupying the dedup slot with a
 * zero-amount credit and checking reconcile refuses to call the booking confirmed.
 *
 * `confirmed` is not an internal detail: /api/v1/payments/sync returns it to the browser, where
 * EmbeddedCheckout redirects the guest to the confirmation page on it.
 */
const CUSTOMER = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';

/** The MUR pin api_create_payment mints for 2 × €50 at the 53.00 fx floor (no fresh rate seeded). */
const CHARGED_MUR_MINOR = 530000;

describe('reconcilePaymentEvent: confirmation follows the ledger, not the provider', () => {
  let db: TestDb;
  let optionId: string;
  let operatorId: string;
  let admin: SupabaseClient<Database>;

  async function seedPayable(key: string): Promise<{ ref: string; paymentId: string }> {
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
      customerName: 'Ledger Customer',
      customerEmail: 'ledger@example.com',
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

  function paidEvent(ref: string, providerReference: string): PaymentEvent {
    return {
      outcome: 'paid',
      bookingRef: ref,
      providerReference,
      amountMinor: CHARGED_MUR_MINOR,
      currency: 'MUR',
      raw: { status: 'paid' },
    };
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
         values ($1, 'ledger-tour', 'activity', 'Ledger Tour', 'Sightseeing tours', 'published')
         returning id`,
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
      `insert into activity_option_prices (activity_option_id, label, amount_minor)
       values ($1, 'Adult', 5000)`,
      [optionId],
    );
    admin = makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>;
  });

  afterAll(async () => {
    await db.close();
  });

  it('confirms when the credit really lands', async () => {
    const { ref } = await seedPayable('credit-ok');
    await db.as({ sub: 'service', role: 'service_role' });

    const result = await reconcilePaymentEvent(admin, paidEvent(ref, 'peach_ok_1'));

    expect(result).toMatchObject({ found: true, confirmed: true, outcome: 'paid' });
    const booking = await db.pg.query<{ status: string; payment_state: string }>(
      `select status, payment_state from bookings where ref = $1`,
      [ref],
    );
    expect(booking.rows[0]).toMatchObject({ status: 'confirmed', payment_state: 'paid' });
  });

  it('refuses to report a booking confirmed when the ledger discarded the credit', async () => {
    const { ref, paymentId } = await seedPayable('credit-lost');

    // Occupy the (payment_id, provider_event_id, type) dedup slot with a credit of ZERO, so the real
    // settlement below collides and writes nothing — the shape of every "success reported, nothing
    // recorded" failure, whatever produced it.
    await db.asOwner();
    await db.pg.query(
      `insert into payment_events (payment_id, type, provider_event_id, amount_minor, occurred_at, payload)
       values ($1, 'paid', $2, 0, now(), '{}'::jsonb)`,
      [paymentId, 'peach_collide_1'],
    );

    await db.as({ sub: 'service', role: 'service_role' });
    const result = await reconcilePaymentEvent(admin, paidEvent(ref, 'peach_collide_1'));

    expect(
      result.confirmed,
      'reconcile reported a confirmed booking while the ledger credited nothing — the guest is sent ' +
        'to a confirmation page for a booking the expiry sweep will release',
    ).toBe(false);
    expect(result.outcome).toBe('quarantined:credit_not_applied');

    // The booking must NOT have been confirmed, and must be flagged so the sweep cannot release it.
    const booking = await db.pg.query<{ status: string }>(
      `select status from bookings where ref = $1`,
      [ref],
    );
    expect(booking.rows[0]!.status).toBe('payment_pending');
    const flagged = await db.pg.query<{ settlement_review_at: string | null }>(
      `select settlement_review_at from payments where id = $1`,
      [paymentId],
    );
    expect(
      flagged.rows[0]!.settlement_review_at,
      'an uncredited settlement was left unflagged, so the expiry sweep can still release the seat',
    ).not.toBeNull();
  });

  it('still reports confirmed on a genuine replay of an already-credited event', async () => {
    // Idempotency must not read as a shortfall: the first delivery credited the full total, so the
    // replay's no-op insert leaves the ledger already satisfied.
    const { ref } = await seedPayable('credit-replay');
    await db.as({ sub: 'service', role: 'service_role' });

    const first = await reconcilePaymentEvent(admin, paidEvent(ref, 'peach_replay_1'));
    const replay = await reconcilePaymentEvent(admin, paidEvent(ref, 'peach_replay_1'));

    expect(first.confirmed).toBe(true);
    expect(
      replay.confirmed,
      'a duplicate delivery must stay idempotent, not read as a failure',
    ).toBe(true);
    expect(replay.outcome).toBe('paid');
  });
});
