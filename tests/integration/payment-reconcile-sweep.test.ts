import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
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

/**
 * Stubs getCheckoutStatus to a fixed outcome per checkout id, echoing the booking ref the sweep
 * needs. Reports amount + currency like the real Peach status payload does — settlement is strict
 * since the 2026-07-17 review (a settled event missing either is QUARANTINED, never credited), so a
 * fixture that omits them tests the quarantine path, not the confirm path. `amountMinor: undefined`
 * in a status entry deliberately produces that incomplete payload.
 */
class SweepStubProvider extends StubPaymentProvider implements PaymentProvider {
  constructor(
    private readonly statuses: Record<
      string,
      {
        outcome: PaymentEvent['outcome'];
        ref: string;
        amountMinor?: number | null;
        currency?: string | null;
      }
    >,
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
      amountMinor: hit.amountMinor ?? null,
      currency: hit.currency === undefined ? 'EUR' : hit.currency,
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
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId: occId,
      party: { Adult: 2 },
      customerName: 'Stuck Customer',
      customerEmail: 'stuck@example.com',
      source: 'web',
      idempotencyKey: `${key}-book`,
    });
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
      chk_paid: { outcome: 'paid', ref: a.ref, amountMinor: 10000 }, // 2 × €50, the full total
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
      currency: 'EUR',
      raw: {},
    });
    expect(shortResult.confirmed).toBe(false);

    const fullResult = await reconcilePaymentEvent(admin, {
      outcome: 'paid',
      bookingRef: full.ref,
      providerReference: 'peach_full',
      amountMinor: 10000, // the full total
      currency: 'EUR',
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

  it('QUARANTINES a settled event missing its amount — never credited as the full total', async () => {
    // The old behaviour credited an amount-less 'paid' event as the FULL booking total, turning a
    // malformed provider payload into a full-value settlement. Now: no ledger write at all.
    const q = await seedPending('quarantine-amt', null);
    await db.as({ sub: 'service', role: 'service_role' });
    const admin = makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>;

    const res = await reconcilePaymentEvent(admin, {
      outcome: 'paid',
      bookingRef: q.ref,
      providerReference: 'peach_no_amount',
      amountMinor: null,
      currency: 'EUR',
      raw: {},
    });
    expect(res).toEqual({ found: true, confirmed: false, outcome: 'quarantined:no_amount' });

    await db.asOwner();
    const events = (
      await db.pg.query<{ n: number }>(
        `select count(*)::int as n from payment_events where payment_id = $1 and type = 'paid'`,
        [q.paymentId],
      )
    ).rows[0]!.n;
    expect(events).toBe(0); // nothing written — a later COMPLETE event can still settle cleanly
    const status = (
      await db.pg.query<{ status: string }>(`select status from bookings where ref = $1`, [q.ref])
    ).rows[0]!.status;
    expect(status).toBe('payment_pending');
  });

  it('QUARANTINES a settled event in the wrong currency', async () => {
    const q = await seedPending('quarantine-cur', null);
    await db.as({ sub: 'service', role: 'service_role' });
    const admin = makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>;

    const res = await reconcilePaymentEvent(admin, {
      outcome: 'paid',
      bookingRef: q.ref,
      providerReference: 'peach_wrong_currency',
      amountMinor: 10000, // right number, wrong unit — 10000 MUR is ~€200 short
      currency: 'MUR',
      raw: {},
    });
    expect(res.outcome).toBe('quarantined:currency_mismatch');
    expect(res.confirmed).toBe(false);
  });

  it('QUARANTINES a settled event with no provider reference (it could never dedup)', async () => {
    // (payment_id, provider_event_id) is the ledger's dedup key and NULLs never collide in a unique
    // index — a reference-less paid event would append again on every webhook retry.
    const q = await seedPending('quarantine-ref', null);
    await db.as({ sub: 'service', role: 'service_role' });
    const admin = makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>;

    const res = await reconcilePaymentEvent(admin, {
      outcome: 'paid',
      bookingRef: q.ref,
      providerReference: null,
      amountMinor: 10000,
      currency: 'EUR',
      raw: {},
    });
    expect(res.outcome).toBe('quarantined:no_provider_reference');
  });

  it('failed/pending events still flow (no money credited, so no strict gate)', async () => {
    const q = await seedPending('quarantine-failed-ok', null);
    await db.as({ sub: 'service', role: 'service_role' });
    const admin = makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>;

    const res = await reconcilePaymentEvent(admin, {
      outcome: 'failed',
      bookingRef: q.ref,
      providerReference: 'peach_declined',
      amountMinor: null, // declines legitimately carry no settled amount
      currency: null,
      raw: {},
    });
    expect(res.outcome).toBe('failed');
    expect(res.found).toBe(true);
  });
});
