import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { makeSupabaseShim } from '../db/supabase-pglite';
import type { ServiceContext } from '@/lib/services/context';
import type { Database } from '@/lib/supabase/types';
import type { PaymentEvent, PaymentProvider } from '@/lib/payments/types';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { reconcilePaymentsPending } from '@/lib/services/maintenance';
import { reconcilePaymentEvent } from '@/lib/payments/reconcile';

/**
 * The webhook-less safety net: the maintenance cron re-queries Peach for recent `payment_pending`
 * bookings (those carrying a stored checkout id) and confirms the ones that actually paid, reusing the
 * idempotent settlement path (getCheckoutStatus → reconcilePaymentEvent → append_payment_event). This
 * proves a paid checkout confirms the booking, a still-pending one is left alone, an un-checkout'd /
 * out-of-grace booking is never enumerated, and a second sweep is a no-op.
 *
 * The sweep runs as the cron does: SERVICE-ROLE (auth.uid() null). The enumeration RPC is granted only
 * to service_role, and reconcilePaymentEvent appends across users via the admin client — here a PGlite-
 * backed Supabase shim, so the SQL (RLS bypass, the append RPC) is genuine, not mocked.
 */
const CUSTOMER = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';

/** Stubs getCheckoutStatus to a fixed outcome per checkout id, echoing the booking ref the sweep needs. */
class SweepStubProvider extends StubPaymentProvider implements PaymentProvider {
  constructor(
    private readonly statuses: Record<string, { outcome: PaymentEvent['outcome']; ref: string }>,
  ) {
    super();
  }
  override async getCheckoutStatus(checkoutId: string): Promise<PaymentEvent> {
    const hit = this.statuses[checkoutId];
    if (!hit) throw new Error(`unexpected checkout id queried: ${checkoutId}`);
    return {
      outcome: hit.outcome,
      bookingRef: hit.ref,
      providerReference: `peach_status_${checkoutId}`,
      amountMinor: null,
      raw: { checkoutId, status: hit.outcome },
    };
  }
}

describe('reconcilePaymentsPending: server-side sweep confirms paid stuck bookings', () => {
  let db: TestDb;
  let optionId: string;
  let operatorId: string;

  /** Book + create a payment (as the customer) and stamp a checkout id (as owner). Returns ref + paymentId. */
  async function seedPending(
    key: string,
    checkoutId: string | null,
  ): Promise<{ ref: string; paymentId: string }> {
    await db.asOwner();
    const occId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '5 days', now() + interval '5 days 3 hours', 20) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = (
      await db.pg.query<{ data: { ref: string } }>(`select api_book($1::jsonb) as data`, [
        JSON.stringify({
          occurrenceId: occId,
          party: { Adult: 2 },
          customerName: 'Stuck Customer',
          customerEmail: 'stuck@example.com',
          source: 'web',
          idempotencyKey: `${key}-book`,
        }),
      ])
    ).rows[0]!.data;
    const payment = (
      await db.pg.query<{ data: { paymentId: string } }>(
        `select api_create_payment($1::jsonb) as data`,
        [JSON.stringify({ bookingRef: booking.ref, idempotencyKey: `${key}-pay` })],
      )
    ).rows[0]!.data;

    if (checkoutId) {
      // Server-only since 20260807000000 (as createPaymentLink records it in production).
      await db.as({ role: 'service_role' });
      await db.pg.query(`select api_record_payment_checkout($1::jsonb) as data`, [
        JSON.stringify({ paymentId: payment.paymentId, checkoutId }),
      ]);
      await db.as({ sub: CUSTOMER, role: 'authenticated' });
    }
    return { ref: booking.ref, paymentId: payment.paymentId };
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
         values ($1, 'sweep-tour', 'activity', 'Sweep Tour', 'Sightseeing tours', 'published') returning id`,
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

  it('confirms the paid booking, leaves pending untouched, never enumerates the excluded one, and is idempotent', async () => {
    // A: paid checkout (must confirm). B: pending checkout (must stay payment_pending).
    const a = await seedPending('sweep-a', 'chk_paid');
    const b = await seedPending('sweep-b', 'chk_pending');
    // C: NO checkout id (never persisted) → excluded. D: a checkout id but created 10h ago → out of grace.
    const c = await seedPending('sweep-c', null);
    const d = await seedPending('sweep-d', 'chk_old');
    await db.asOwner();
    await db.pg.query(
      `update bookings set created_at = now() - interval '10 hours' where ref = $1`,
      [d.ref],
    );

    const provider = new SweepStubProvider({
      chk_paid: { outcome: 'paid', ref: a.ref },
      chk_pending: { outcome: 'pending', ref: b.ref },
    });

    // The cron runs as service_role; the enumeration RPC is service_role-only and the append bypasses RLS.
    await db.as({ sub: 'service', role: 'service_role' });
    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: provider,
      ai: createStubAiProvider(),
      admin: makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>,
      now: () => new Date(),
    };

    // The enumeration RPC itself excludes C (no checkout id) and D (out of grace) — only A + B.
    const enumerated = (
      await db.pg.query<{ data: Array<{ ref: string; paymentId: string; checkoutId: string }> }>(
        `select api_pending_payment_checkouts($1::jsonb) as data`,
        [JSON.stringify({})],
      )
    ).rows[0]!.data;
    const enumeratedRefs = enumerated.map((row) => row.ref).sort();
    expect(enumeratedRefs).toEqual([a.ref, b.ref].sort());
    expect(enumeratedRefs).not.toContain(c.ref);
    expect(enumeratedRefs).not.toContain(d.ref);

    const summary = await reconcilePaymentsPending(ctx);
    expect(summary).toEqual({ queried: 2, confirmed: 1, pending: 1, failed: 0, errored: 0 });

    await db.asOwner();
    const statusOf = async (ref: string): Promise<{ status: string; payment_state: string }> =>
      (
        await db.pg.query<{ status: string; payment_state: string }>(
          `select status, payment_state from bookings where ref = $1`,
          [ref],
        )
      ).rows[0]!;
    const paidEventCount = async (paymentId: string): Promise<number> =>
      (
        await db.pg.query<{ n: number }>(
          `select count(*)::int as n from payment_events where payment_id = $1 and type = 'paid'`,
          [paymentId],
        )
      ).rows[0]!.n;

    // A confirmed with a paid ledger event; B still payment_pending; C + D never touched.
    expect(await statusOf(a.ref)).toEqual({ status: 'confirmed', payment_state: 'paid' });
    expect(await paidEventCount(a.paymentId)).toBe(1);
    expect((await statusOf(b.ref)).status).toBe('payment_pending');
    expect((await statusOf(c.ref)).status).toBe('payment_pending');
    expect((await statusOf(d.ref)).status).toBe('payment_pending');

    // Second sweep is idempotent: A is now settled so it drops out of enumeration; only B remains pending.
    await db.as({ sub: 'service', role: 'service_role' });
    const second = await reconcilePaymentsPending(ctx);
    expect(second).toEqual({ queried: 1, confirmed: 0, pending: 1, failed: 0, errored: 0 });

    await db.asOwner();
    expect(await statusOf(a.ref)).toEqual({ status: 'confirmed', payment_state: 'paid' });
    expect(await paidEventCount(a.paymentId)).toBe(1); // no second paid event — the append deduped
  });

  it('does NOT confirm a short/underpaid "paid" settlement — only the full amount confirms', async () => {
    // Booking total = 2 × €50 = 10000 minor. A success-code event must credit what was ACTUALLY settled,
    // so a half-amount capture leaves the booking pending (the underpayment guard), while a full one confirms.
    const short = await seedPending('underpay-short', null);
    const full = await seedPending('underpay-full', null);

    await db.as({ sub: 'service', role: 'service_role' });
    const admin = makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>;

    const shortResult = await reconcilePaymentEvent(admin, {
      outcome: 'paid',
      bookingRef: short.ref,
      providerReference: 'peach_short',
      amountMinor: 5000, // half the €100 total
      raw: {},
    });
    expect(shortResult.confirmed).toBe(false);

    const fullResult = await reconcilePaymentEvent(admin, {
      outcome: 'paid',
      bookingRef: full.ref,
      providerReference: 'peach_full',
      amountMinor: 10000, // the full total
      raw: {},
    });
    expect(fullResult.confirmed).toBe(true);

    await db.asOwner();
    const statusOf = async (ref: string): Promise<{ status: string; payment_state: string }> =>
      (
        await db.pg.query<{ status: string; payment_state: string }>(
          `select status, payment_state from bookings where ref = $1`,
          [ref],
        )
      ).rows[0]!;
    expect((await statusOf(short.ref)).status).toBe('payment_pending'); // underpaid → not confirmed
    expect(await statusOf(full.ref)).toEqual({ status: 'confirmed', payment_state: 'paid' });
  });
});
