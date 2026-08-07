import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { pgliteServiceRoleRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { hashQuoteToken, mintQuoteToken } from '@/lib/quotes/token';
import { QUOTE_BALANCE_TOKEN_COOKIE } from '@/lib/quotes/link-cookie';
import { resolveBalanceForToken } from '@/lib/quotes/resolve';
import { SITE } from '@/lib/seo/site';
import type { CreatePaymentLinkInput } from '@/lib/services/payments';

/**
 * The DURABLE balance link's guest end: resolveBalanceForToken (the whole authorization) and
 * POST /api/v1/quotes/{ref}/balance/pay (the fresh-checkout-on-click that makes the link durable).
 *
 * The balance's analogue of resolveQuoteForToken + the deposit pay route, so it fails closed in the
 * same single-null / single-404 shape (no existence oracle for quote refs), authenticates by the
 * BALANCE-link cookie (a distinct token from the deposit link), and mints the checkout through the
 * shared create_payment body so two opens of the link reuse ONE session rather than fork two.
 *
 * `createPaymentLink` is FAKED here, deliberately and for the same reason the deposit pay test fakes
 * it: the one-payable-session invariant is enforced by the single-flight lease in SQL and is proven
 * against the real database in tests/integration/quote-checkout-entry.test.ts (the balance shares that
 * exact lease). What this test must prove is the ROUTE's contract — that it authenticates by the
 * balance token, mints with purpose 'balance' and the balance page's return URL, and never forks a
 * second booking/session. The fake returns a checkout id derived from the booking ref, so "the same
 * checkout id twice" is exactly "the same booking twice".
 */

const INTERNAL_NOTE = 'Margin is thin — do not discount further.';

const hoisted = vi.hoisted(() => ({
  shim: null as SupabaseShim | null,
  /** Every `createPaymentLink` input the route produced, in order. */
  calls: [] as CreatePaymentLinkInput[],
}));

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

vi.mock('@/lib/services/payments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/payments')>();
  return {
    ...actual,
    createPaymentLink: async (
      _ctx: Parameters<typeof actual.createPaymentLink>[0],
      input: CreatePaymentLinkInput,
    ) => {
      hoisted.calls.push(input);
      return {
        sessionId: `sess_${input.bookingRef}`,
        // Derived from the booking ref: two different bookings can never share a checkout id, so
        // "the same checkout id twice" is exactly "the same booking twice".
        checkoutId: `chk_${input.bookingRef}`,
        provider: 'stub',
        chargeAmountMinor: 573_000,
        chargeCurrency: 'MUR',
      };
    },
  };
});

const { POST } = await import('../../app/api/v1/quotes/[ref]/balance/pay/route');

describe('the durable balance link (resolver + pay route)', () => {
  let db: TestDb;
  let seq = 0;

  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  /**
   * A converted, deposit-confirmed quote booking (the state a balance link is sent against). Returns
   * the quote ref and booking ref. `deposit_bps = 10000` makes it a pay-in-full quote that owes nothing
   * once the deposit settles.
   */
  async function depositConfirmed(
    totalMinor: number,
    depositBps: number,
  ): Promise<{ quoteRef: string; bookingRef: string }> {
    seq += 1;
    const quoteRef = `QBALP${seq}`;
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, status, valid_until, total_minor,
                           deposit_bps, internal_notes, token_hash, sent_at)
       values ($1, 'Jean Rivière', $2, 'sent', current_date + 7, $3, $4, $5, $6, now()) returning id`,
      [quoteRef, `balp${seq}@example.com`, totalMinor, depositBps, INTERNAL_NOTE, 'd'.repeat(64)],
    );
    const quoteId = rows[0]!.id;
    await db.pg.query(
      `insert into quote_items (quote_id, position, kind, description, starts_at, quantity,
                                unit_amount_minor, subtotal_minor)
       values ($1, 1, 'custom', 'Private guide, full day', now() + interval '10 days', 1, $2, $2)`,
      [quoteId, totalMinor],
    );
    await db.as({ role: 'service_role' });
    const booking = await call<{ ref: string }>('api_convert_quote', { quoteId });
    const bookingRef = booking.ref;
    const dep = await call<{ paymentId: string; amountMinor: number }>('api_create_quote_payment', {
      bookingRef,
      idempotencyKey: `${bookingRef}-dep`,
      purpose: 'booking',
    });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'paid', $2::text, $3::bigint, now(), '{}'::jsonb)`,
      [dep.paymentId, `${bookingRef}-dep-evt`, dep.amountMinor],
    );
    return { quoteRef, bookingRef };
  }

  /** Store the SHA-256 of a fresh balance token on the quote (what the staff route does) and return the
   *  raw token, exactly as the operator's copied URL carries it. */
  async function armBalanceLink(quoteRef: string): Promise<string> {
    const token = mintQuoteToken();
    await db.asOwner();
    await db.pg.query(`update quotes set balance_token_hash = $2 where ref = $1`, [
      quoteRef,
      await hashQuoteToken(token),
    ]);
    return token;
  }

  async function payBalance(ref: string, token: string | null): Promise<Response> {
    await db.asOwner();
    const headers = new Headers();
    if (token !== null) headers.set('cookie', `${QUOTE_BALANCE_TOKEN_COOKIE}=${token}`);
    return POST(
      new Request(`https://x/api/v1/quotes/${ref}/balance/pay`, { method: 'POST', headers }),
      { params: Promise.resolve({ ref }) },
    );
  }

  async function balanceRowCount(bookingRef: string): Promise<number> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from payments p join bookings b on b.id = p.booking_id
        where b.ref = $1 and p.purpose = 'balance'`,
      [bookingRef],
    );
    return rows[0]!.n;
  }

  beforeAll(async () => {
    db = await createTestDb();
    hoisted.shim = makeSupabaseShim(db.pg);
    setRouteContext({
      db: pgliteServiceRoleRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    });
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  beforeEach(async () => {
    hoisted.calls.length = 0;
    await db.asOwner();
  });

  // ── resolveBalanceForToken — the whole authorization ────────────────────────
  describe('resolveBalanceForToken', () => {
    it('resolves the amount owed for a valid token, leaking no internal note', async () => {
      const { quoteRef } = await depositConfirmed(100000, 1000); // owes 90000 after 10% deposit
      const token = await armBalanceLink(quoteRef);

      const balance = await resolveBalanceForToken(quoteRef, token);
      expect(balance).not.toBeNull();
      expect(balance!.ref).toBe(quoteRef);
      expect(balance!.customerName).toBe('Jean Rivière');
      expect(balance!.currency).toBe('EUR');
      expect(balance!.balanceDueMinor).toBe(90000);
      // The staff-only margin note lives on the same quote row and must never be carried here.
      expect(JSON.stringify(balance)).not.toContain(INTERNAL_NOTE);
    });

    it('returns null for a WRONG token — the same answer as an unknown ref (no oracle)', async () => {
      const { quoteRef } = await depositConfirmed(100000, 1000);
      await armBalanceLink(quoteRef);
      // A well-formed but non-matching token.
      expect(await resolveBalanceForToken(quoteRef, 'a'.repeat(64))).toBeNull();
    });

    it('returns null for an absent / malformed token', async () => {
      const { quoteRef } = await depositConfirmed(100000, 1000);
      await armBalanceLink(quoteRef);
      expect(await resolveBalanceForToken(quoteRef, '')).toBeNull();
      expect(await resolveBalanceForToken(quoteRef, 'not-hex')).toBeNull();
    });

    it('returns null when no balance link was ever armed (null stored hash)', async () => {
      const { quoteRef } = await depositConfirmed(100000, 1000);
      // Even a real, freshly-minted token cannot open a quote whose balance_token_hash is null.
      expect(await resolveBalanceForToken(quoteRef, mintQuoteToken())).toBeNull();
    });

    it('returns null for a fully-paid booking (nothing owed), even with a valid token', async () => {
      const { quoteRef } = await depositConfirmed(100000, 10000); // pay-in-full → owes 0
      const token = await armBalanceLink(quoteRef);
      expect(await resolveBalanceForToken(quoteRef, token)).toBeNull();
    });

    it('returns null for a cancelled booking, even with a valid token', async () => {
      const { quoteRef, bookingRef } = await depositConfirmed(100000, 1000);
      const token = await armBalanceLink(quoteRef);
      await db.asOwner();
      await db.pg.query(`update bookings set status = 'cancelled' where ref = $1`, [bookingRef]);
      expect(await resolveBalanceForToken(quoteRef, token)).toBeNull();
    });
  });

  // ── POST /api/v1/quotes/:ref/balance/pay — fresh checkout on each open ───────
  describe('POST /balance/pay', () => {
    it('mints a balance checkout with purpose=balance and the balance page return URL', async () => {
      const { quoteRef, bookingRef } = await depositConfirmed(100000, 1000);
      const token = await armBalanceLink(quoteRef);

      const res = await payBalance(quoteRef, token);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.bookingRef).toBe(bookingRef);
      expect(body.data.checkoutId).toBe(`chk_${bookingRef}`);

      expect(hoisted.calls).toHaveLength(1);
      expect(hoisted.calls[0]!.purpose).toBe('balance');
      expect(hoisted.calls[0]!.authorizedBy).toBe('quote');
      expect(hoisted.calls[0]!.bookingRef).toBe(bookingRef);
      // Back to the guest's OWN balance page after a redirect-based 3-D Secure step, never /bookings.
      expect(hoisted.calls[0]!.returnUrl).toBe(`${SITE.url}/quotes/${quoteRef}/balance`);
    });

    it('two opens of the link yield ONE session for the one booking, never a fork', async () => {
      const { quoteRef, bookingRef } = await depositConfirmed(100000, 1000);
      const token = await armBalanceLink(quoteRef);

      const first = await (await payBalance(quoteRef, token)).json();
      const second = await (await payBalance(quoteRef, token)).json();

      // A fresh mint on EACH open (never a stale embedded cid) — and both resolve to the ONE booking's
      // session, so the durable link can be opened again and again without forking a second payable one.
      expect(first.data.checkoutId).toBe(`chk_${bookingRef}`);
      expect(second.data.checkoutId).toBe(first.data.checkoutId);
      expect(hoisted.calls).toHaveLength(2);
      expect(hoisted.calls.every((c) => c.purpose === 'balance')).toBe(true);
    });

    it('answers 404 with no cookie, and mints nothing', async () => {
      const { quoteRef } = await depositConfirmed(100000, 1000);
      await armBalanceLink(quoteRef);
      expect((await payBalance(quoteRef, null)).status).toBe(404);
      expect(hoisted.calls).toHaveLength(0);
    });

    it('answers 404 for a WRONG token — the same 404 as the deposit page (no oracle)', async () => {
      const { quoteRef } = await depositConfirmed(100000, 1000);
      await armBalanceLink(quoteRef);
      expect((await payBalance(quoteRef, 'a'.repeat(64))).status).toBe(404);
      expect(hoisted.calls).toHaveLength(0);
    });

    it('answers 404 for a fully-paid booking (nothing to charge), and mints nothing', async () => {
      const { quoteRef, bookingRef } = await depositConfirmed(100000, 10000);
      const token = await armBalanceLink(quoteRef);
      expect((await payBalance(quoteRef, token)).status).toBe(404);
      expect(await balanceRowCount(bookingRef)).toBe(0);
      expect(hoisted.calls).toHaveLength(0);
    });
  });
});
