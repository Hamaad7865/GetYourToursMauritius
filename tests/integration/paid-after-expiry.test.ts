import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { pgliteRpc } from '../db/rpc';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { setRouteContext } from '../db/route-context';
import type { ServiceContext } from '@/lib/services/context';
import type { Database } from '@/lib/supabase/types';
import type { PaymentEvent, PaymentOutcome } from '@/lib/payments/types';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import {
  bookingRefFromMerchantTransactionId,
  generateMerchantTransactionId,
} from '@/lib/payments/merchant-ref';
import { processPaymentWebhook } from '@/lib/payments/webhook';
import { reconcileLateCaptures } from '@/lib/services/maintenance';

/**
 * Production, 30 Oct 2026 (BMT41EDB8E4EA1D4): a guest's hold lapsed while the payment widget was open,
 * the cron expired the booking, and ninety seconds later Peach captured MUR 7,020 on the still-open
 * session. Nothing recorded it. The guest rebooked, paid again, travelled once, and had to email us to
 * find out she'd been charged twice. A second capture (a tour-change difference, 5 Sep) was stranded
 * the same way.
 *
 * Three doors should each have caught it, and none could:
 *  - the browser's /payments/sync looked the booking up by the raw merchantTransactionId, which since
 *    the switch to GENERATED ids is opaque, so every sync 404'd;
 *  - the webhook's re-query fallback refused any booking no longer `payment_pending`;
 *  - the reconcile sweep only enumerates `payment_pending` bookings, and never `change_addon` rows.
 *
 * Every assertion here runs the real SQL (PGlite): append_payment_event is what routes a capture on an
 * expired booking to refund_pending, and that routing is the outcome these doors must reach.
 */

const CUSTOMER = 'c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0';
const STRANGER = 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0';
const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-must-be-long-enough-1234567890';
/** 2 adults × €50 = €100, pinned at the 53.00 fx floor → MUR 5,300 = 530000 minor. */
const PINNED_MUR_MINOR = 530000;

const hoisted = vi.hoisted(() => ({ shim: null as SupabaseShim | null }));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return {
    buildServiceContext: () => mod.requireRouteContext(),
    serviceRoleRpcContext: () => mod.requireRouteContext(),
  };
});

const { POST: syncPost } = await import('../../app/api/v1/payments/sync/route');

/**
 * Answers getCheckoutStatus the way PeachProvider does: the merchantTransactionId verbatim, and
 * `bookingRef` PARSED out of it — which for a generated id is the opaque id itself, not a booking ref.
 * verifyWebhook throws unless an HMAC-verified event has been armed, i.e. the signature check failed.
 */
class PeachLikeProvider extends StubPaymentProvider {
  readonly statuses = new Map<
    string,
    { outcome: PaymentOutcome; mtid: string; amountMinor?: number }
  >();
  readonly queried: string[] = [];
  verified: PaymentEvent | null = null;

  override async verifyWebhook(): Promise<PaymentEvent> {
    if (!this.verified) throw new Error('Invalid Peach webhook signature');
    return this.verified;
  }

  override async getCheckoutStatus(checkoutId: string): Promise<PaymentEvent> {
    this.queried.push(checkoutId);
    const hit = this.statuses.get(checkoutId);
    if (!hit) throw new Error(`unexpected checkout id queried: ${checkoutId}`);
    return {
      outcome: hit.outcome,
      bookingRef: bookingRefFromMerchantTransactionId(hit.mtid),
      merchantTransactionId: hit.mtid,
      providerReference: hit.outcome === 'paid' ? `txn_${checkoutId}` : checkoutId,
      providerCheckoutId: checkoutId,
      amountMinor: hit.amountMinor ?? PINNED_MUR_MINOR,
      currency: 'MUR',
      raw: { checkoutId },
    };
  }
}

async function bearer(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

describe('a capture that lands after the booking stopped waiting for it', () => {
  let db: TestDb;
  let optionId: string;
  let operatorId: string;
  let provider: PeachLikeProvider;
  let admin: SupabaseClient<Database>;
  let seq = 0;

  interface Seeded {
    ref: string;
    bookingId: string;
    paymentId: string;
    checkoutId: string;
    mtid: string;
  }

  /** A web booking with its payment row, one recorded merchant id and one recorded checkout session —
   *  exactly what createPaymentLink leaves behind before the guest pays. */
  async function seedCheckout(opts: { recordMerchantRef?: boolean } = {}): Promise<Seeded> {
    seq += 1;
    await db.asOwner();
    const occId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '5 days', now() + interval '5 days 3 hours', 20) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const { ref } = await apiBook<{ ref: string }>(db, {
      occurrenceId: occId,
      party: { Adult: 2 },
      customerName: 'Late Payer',
      customerEmail: 'late@example.com',
      source: 'web',
      idempotencyKey: `late-${seq}-book`,
    });
    const { paymentId } = (
      await db.pg.query<{ data: { paymentId: string } }>(
        `select api_create_payment($1::jsonb) as data`,
        [JSON.stringify({ bookingRef: ref, idempotencyKey: `late-${seq}-pay` })],
      )
    ).rows[0]!.data;

    const mtid = opts.recordMerchantRef === false ? ref : generateMerchantTransactionId();
    const checkoutId = `chk_${seq}_${mtid}`;
    await db.as({ role: 'service_role' });
    if (opts.recordMerchantRef !== false) {
      await db.pg.query(`select api_record_merchant_ref($1::jsonb)`, [
        JSON.stringify({ paymentId, merchantTxnId: mtid }),
      ]);
    }
    await db.pg.query(`select api_record_payment_checkout($1::jsonb)`, [
      JSON.stringify({ paymentId, checkoutId }),
    ]);

    await db.asOwner();
    const bookingId = (
      await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [ref])
    ).rows[0]!.id;
    return { ref, bookingId, paymentId, checkoutId, mtid };
  }

  /** Age the booking past its 30-minute window and let the REAL maintenance sweep expire it. */
  async function expire(ref: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(
      `update bookings set created_at = now() - interval '40 minutes' where ref = $1`,
      [ref],
    );
    await db.as({ role: 'service_role' });
    await db.pg.query(`select run_booking_maintenance('{}'::jsonb)`);
    expect(await statusOf(ref)).toBe('expired');
  }

  async function statusOf(ref: string): Promise<string> {
    await db.asOwner();
    return (
      await db.pg.query<{ status: string }>(`select status from bookings where ref = $1`, [ref])
    ).rows[0]!.status;
  }

  async function paidMinor(paymentId: string): Promise<number> {
    await db.asOwner();
    return Number(
      (
        await db.pg.query<{ paid_minor: string }>(`select paid_minor from payments where id = $1`, [
          paymentId,
        ])
      ).rows[0]!.paid_minor,
    );
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!
      .id;
    for (const id of [CUSTOMER, STRANGER]) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
      await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [id]);
    }
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
    hoisted.shim = makeSupabaseShim(db.pg);
    admin = hoisted.shim as unknown as SupabaseClient<Database>;
  });

  beforeEach(async () => {
    provider = new PeachLikeProvider();
    // The shim runs as whatever role the session holds; the trusted paths run as service_role.
    await db.as({ role: 'service_role' });
    setRouteContext({
      db: pgliteRpc(db.pg),
      payments: provider,
      ai: createStubAiProvider(),
      admin,
      now: () => new Date(),
      locale: 'en',
    } satisfies ServiceContext);
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  describe('POST /api/v1/payments/sync', () => {
    async function sync(sub: string, checkoutId: string): Promise<Response> {
      const res = await syncPost(
        new Request('http://localhost/api/v1/payments/sync', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${await bearer(sub)}`,
          },
          body: JSON.stringify({ checkoutId }),
        }),
      );
      await db.as({ role: 'service_role' });
      return res;
    }

    it('confirms a booking paid under a GENERATED merchant id (it used to 404 on every one)', async () => {
      const s = await seedCheckout();
      provider.statuses.set(s.checkoutId, { outcome: 'paid', mtid: s.mtid });
      await db.as({ role: 'service_role' });

      const res = await sync(CUSTOMER, s.checkoutId);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { confirmed: boolean } };
      expect(body.data.confirmed).toBe(true);
      expect(await statusOf(s.ref)).toBe('confirmed');
    });

    it('still refuses a caller who does not own the booking', async () => {
      const s = await seedCheckout();
      provider.statuses.set(s.checkoutId, { outcome: 'paid', mtid: s.mtid });
      await db.as({ role: 'service_role' });

      const res = await sync(STRANGER, s.checkoutId);

      expect(res.status).toBe(403);
      expect(await statusOf(s.ref)).toBe('payment_pending');
    });

    // The 30 Oct guest, had her browser's sync worked: the capture is recorded and the booking goes to
    // refund_pending, never confirmed. `confirmed` stays true (the payment IS fully paid), which only
    // tells EmbeddedCheckout to skip its poll; the booking page then shows "refund on its way".
    it('records a capture on an EXPIRED booking as refund_pending, not a confirmation', async () => {
      const s = await seedCheckout();
      await expire(s.ref);
      provider.statuses.set(s.checkoutId, { outcome: 'paid', mtid: s.mtid });
      await db.as({ role: 'service_role' });

      const res = await sync(CUSTOMER, s.checkoutId);

      expect(res.status).toBe(200);
      expect(await statusOf(s.ref)).toBe('refund_pending');
      expect(await paidMinor(s.paymentId)).toBe(10000);
    });
  });

  describe('the payment webhook, when the signature does not verify', () => {
    const notify = (mtid: string | null) =>
      processPaymentWebhook(admin, provider, {
        rawBody: JSON.stringify({ merchantTransactionId: mtid }),
        headers: { 'x-webhook-signature': 'deadbeef', 'x-webhook-timestamp': '1' },
        merchantTransactionId: mtid,
      });

    it('records a capture on an EXPIRED booking and routes it to refund_pending', async () => {
      const s = await seedCheckout();
      await expire(s.ref);
      provider.statuses.set(s.checkoutId, { outcome: 'paid', mtid: s.mtid });
      await db.as({ role: 'service_role' });

      await notify(s.mtid);

      expect(provider.queried).toEqual([s.checkoutId]);
      expect(await paidMinor(s.paymentId)).toBe(10000);
      expect(await statusOf(s.ref)).toBe('refund_pending');
    });

    it('finds the capture on the PREVIOUS session after a re-pay replaced it (the 30 Oct shape)', async () => {
      const s = await seedCheckout();
      // The first session was retired as dead and a second one minted on the same payment row.
      const replacement = `${s.checkoutId}_2`;
      await db.as({ role: 'service_role' });
      await db.pg.query(`select api_clear_payment_checkout($1::jsonb)`, [
        JSON.stringify({ paymentId: s.paymentId, checkoutId: s.checkoutId }),
      ]);
      await db.pg.query(`select api_record_payment_checkout($1::jsonb)`, [
        JSON.stringify({ paymentId: s.paymentId, checkoutId: replacement }),
      ]);
      await expire(s.ref);
      provider.statuses.set(replacement, { outcome: 'pending', mtid: s.mtid });
      provider.statuses.set(s.checkoutId, { outcome: 'paid', mtid: s.mtid });
      await db.as({ role: 'service_role' });

      await notify(s.mtid);

      expect(await paidMinor(s.paymentId)).toBe(10000);
      expect(await statusOf(s.ref)).toBe('refund_pending');
    });

    it('does not query the provider for a payment row that is already fully paid', async () => {
      const s = await seedCheckout();
      provider.statuses.set(s.checkoutId, { outcome: 'paid', mtid: s.mtid });
      await db.as({ role: 'service_role' });
      await notify(s.mtid); // first delivery settles it
      expect(await statusOf(s.ref)).toBe('confirmed');
      provider.queried.length = 0;

      await notify(s.mtid); // a replay

      expect(provider.queried).toEqual([]);
    });

    it('keeps the payment_pending gate for a legacy id that has no recorded mapping', async () => {
      // A derived id is guessable (it IS the booking ref), so it must not become a way to make us
      // re-query Peach for any booking at will.
      const s = await seedCheckout({ recordMerchantRef: false });
      await expire(s.ref);
      provider.statuses.set(s.checkoutId, { outcome: 'paid', mtid: s.mtid });
      await db.as({ role: 'service_role' });

      await notify(s.mtid);

      expect(provider.queried).toEqual([]);
      expect(await statusOf(s.ref)).toBe('expired');
    });

    it('ignores an id that maps to nothing, and a notification with no id at all', async () => {
      await notify(generateMerchantTransactionId());
      await notify(null);
      expect(provider.queried).toEqual([]);
    });
  });

  describe('reconcileLateCaptures (the cron, for a capture no signal ever reported)', () => {
    const ctx = (): ServiceContext => ({
      db: pgliteRpc(db.pg),
      payments: provider,
      ai: createStubAiProvider(),
      admin,
      now: () => new Date(),
      locale: 'en',
    });

    async function eventCount(paymentId: string): Promise<number> {
      await db.asOwner();
      return (
        await db.pg.query<{ n: number }>(
          `select count(*)::int as n from payment_events where payment_id = $1`,
          [paymentId],
        )
      ).rows[0]!.n;
    }

    /** Leave only `keep` inside the sweep's window, so each test sees just its own rows. The window
     *  reads `updated_at`, which every session mint AND retire stamps (checkout_created_at is nulled
     *  on retire, while the retired session can still capture). */
    async function ageEveryCheckoutBut(keep: string[]): Promise<void> {
      await db.asOwner();
      await db.pg.query(
        `update payments set updated_at = now() - interval '1 day'
          where not (id = any($1::uuid[]))`,
        [keep],
      );
      await db.as({ role: 'service_role' });
    }

    it('records a capture on an expired booking, and the next run finds nothing left to do', async () => {
      const s = await seedCheckout();
      await expire(s.ref);
      await ageEveryCheckoutBut([s.paymentId]);
      provider.statuses.set(s.checkoutId, { outcome: 'paid', mtid: s.mtid });

      const first = await reconcileLateCaptures(ctx());

      expect(first).toEqual({ queried: 1, recorded: 1, errored: 0 });
      expect(await paidMinor(s.paymentId)).toBe(10000);
      expect(await statusOf(s.ref)).toBe('refund_pending');

      await db.as({ role: 'service_role' });
      provider.queried.length = 0;
      const second = await reconcileLateCaptures(ctx());
      expect(second).toEqual({ queried: 0, recorded: 0, errored: 0 });
      expect(provider.queried).toEqual([]);
    });

    it('writes nothing when the late session never captured', async () => {
      const s = await seedCheckout();
      await expire(s.ref);
      await ageEveryCheckoutBut([s.paymentId]);
      provider.statuses.set(s.checkoutId, { outcome: 'failed', mtid: s.mtid });
      const before = await eventCount(s.paymentId);
      await db.as({ role: 'service_role' });

      const result = await reconcileLateCaptures(ctx());

      expect(result).toEqual({ queried: 1, recorded: 0, errored: 0 });
      expect(await eventCount(s.paymentId)).toBe(before);
      expect(await statusOf(s.ref)).toBe('expired');
    });

    it('leaves a booking still waiting for payment to the pending sweep', async () => {
      const s = await seedCheckout();
      await ageEveryCheckoutBut([s.paymentId]);

      const result = await reconcileLateCaptures(ctx());

      expect(result.queried).toBe(0);
      expect(provider.queried).toEqual([]);
    });

    it('stops looking once the session is older than the window', async () => {
      const s = await seedCheckout();
      await expire(s.ref);
      await ageEveryCheckoutBut([]);

      const result = await reconcileLateCaptures(ctx());

      expect(result.queried).toBe(0);
      expect(provider.queried).toEqual([]);
    });

    it('records a tour-change payment captured on a confirmed booking (no sweep covered these)', async () => {
      const s = await seedCheckout();
      provider.statuses.set(s.checkoutId, { outcome: 'paid', mtid: s.mtid });
      await db.as({ role: 'service_role' });
      await processPaymentWebhook(admin, provider, {
        rawBody: '{}',
        headers: {},
        merchantTransactionId: s.mtid,
      });
      expect(await statusOf(s.ref)).toBe('confirmed');

      // The €50 difference row a staff-proposed tour change adds, with its own session and id.
      await db.asOwner();
      const changeId = (
        await db.pg.query<{ id: string }>(
          `insert into payments (booking_id, provider, amount_minor, currency, status, purpose,
                                 charged_amount_minor, charged_currency, idempotency_key)
           values ($1, 'stub', 5000, 'EUR', 'pending', 'change_addon', 265000, 'MUR', $2)
           returning id`,
          [s.bookingId, `late-${seq}-change`],
        )
      ).rows[0]!.id;
      const changeMtid = generateMerchantTransactionId();
      const changeCheckout = `chk_change_${changeMtid}`;
      await db.as({ role: 'service_role' });
      await db.pg.query(`select api_record_merchant_ref($1::jsonb)`, [
        JSON.stringify({ paymentId: changeId, merchantTxnId: changeMtid }),
      ]);
      await db.pg.query(`select api_record_payment_checkout($1::jsonb)`, [
        JSON.stringify({ paymentId: changeId, checkoutId: changeCheckout }),
      ]);
      await ageEveryCheckoutBut([changeId]);
      provider.statuses.set(changeCheckout, {
        outcome: 'paid',
        mtid: changeMtid,
        amountMinor: 265000,
      });

      const result = await reconcileLateCaptures(ctx());

      expect(result).toEqual({ queried: 1, recorded: 1, errored: 0 });
      expect(await paidMinor(changeId)).toBe(5000);
    });
  });

  describe('the payment webhook, when the signature verifies', () => {
    it('credits straight from the verified body, without a status query', async () => {
      const s = await seedCheckout();
      provider.verified = {
        outcome: 'paid',
        bookingRef: bookingRefFromMerchantTransactionId(s.mtid),
        merchantTransactionId: s.mtid,
        providerReference: 'txn_signed',
        providerCheckoutId: s.checkoutId,
        amountMinor: PINNED_MUR_MINOR,
        currency: 'MUR',
        raw: {},
      };
      await db.as({ role: 'service_role' });

      await processPaymentWebhook(admin, provider, {
        rawBody: '{}',
        headers: { 'x-webhook-signature': 'good', 'x-webhook-timestamp': '1' },
        merchantTransactionId: s.mtid,
      });

      expect(provider.queried).toEqual([]);
      expect(await statusOf(s.ref)).toBe('confirmed');
    });
  });
});
