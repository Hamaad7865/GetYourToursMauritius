import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { pgliteServiceRoleRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import type {
  CheckoutSession,
  CreateCheckoutInput,
  PaymentEvent,
  PaymentProvider,
} from '@/lib/payments/types';
import { createStubAiProvider } from '@/lib/ai/stub';
import { SITE } from '@/lib/seo/site';

/**
 * POST /api/v1/admin/quotes/:ref/balance — the operator's "Send balance link" button (Task 5 of the
 * quote-deposit plan; src/lib/admin/quotes.ts `sendBalanceLink`).
 *
 * The deposit confirms the booking and reserves the seat; the balance is chased later by hand. This
 * route mints the balance CHECKOUT for a converted, deposit-confirmed quote booking and hands the
 * operator the public payment URL to copy to the guest. It is the balance's analogue of the send
 * route, so it shares that route's STAFF GATE to the letter — profiles.role, admin OR staff, the SEO
 * hire EXCLUDED (a quote carries the guest's name, email and the operator's margin note) — and, like
 * the send route, its refusals must write nothing and mint nothing.
 *
 * What is asserted here:
 *   - THE STAFF GATE. `requireUser().role` is the JWT's Postgres role selector ('authenticated' for
 *     staff and customer alike), never the business role, so the check runs against real `profiles`
 *     rows: no bearer → 401, a signed-in customer / the SEO hire / no-profile → 403, admin AND staff
 *     admitted.
 *   - NOTHING OWED → 409. A pay-in-full quote (deposit_bps = 10000) is fully paid the moment its
 *     deposit settles, so there is no balance to collect and no balance row may be opened.
 *   - SUCCESS returns { url }, the balance checkout's public payment URL for the copy button.
 *   - THE STAFF-ONLY MARGIN NOTE never leaks: quotes.internal_notes appears nowhere in the response.
 *
 * `requireUser` is faked (the JWT itself is covered elsewhere); the STAFF check is not — the trap it
 * avoids (reading the JWT's Postgres-role claim as the business role) cannot be caught by a mock that
 * hands back a business role nobody uses. `serviceRoleRpcContext` is the PGlite service-role port +
 * the stub payment provider, so createPaymentLink runs the real api_create_quote_payment body and the
 * stub returns a real hosted-checkout redirect URL.
 */

const ADMIN = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const STAFF = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const CUSTOMER = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
const SEO = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
const NO_PROFILE = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';

const hoisted = vi.hoisted(() => ({
  shim: null as SupabaseShim | null,
  /** Bearer token -> auth user id. A token that is not in here is rejected, like a bad JWT. */
  users: new Map<string, string>(),
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

vi.mock('@/lib/http/auth', async () => {
  const { UnauthorizedError } = await import('@/lib/services/errors');
  return {
    requireUser: async (req: Request) => {
      const header = req.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const id = hoisted.users.get(token);
      if (!id) throw new UnauthorizedError();
      // `role` is what a real Supabase JWT carries: the POSTGRES role selector, never the app's
      // business role. A staff gate written against this value admits every signed-in customer.
      return { id, email: 'staff@example.com', role: 'authenticated' };
    },
  };
});

const { POST } = await import('../../app/api/v1/admin/quotes/[ref]/balance/route');

/**
 * A provider shaped like the PRODUCTION one (Peach): an EMBEDDED widget, so `createCheckout` returns a
 * `checkoutId` and NO hosted `redirectUrl` (src/lib/payments/peach.ts returns `{ id, checkoutId,
 * provider }`). The dev stub is the only provider that ever yields a `redirectUrl`, so a route that
 * keys its response on `redirectUrl` looks green under the stub yet 409s every real mint. Only
 * `createCheckout` is exercised by this route.
 */
class PeachLikeProvider implements PaymentProvider {
  readonly name = 'peach-like';
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    return {
      id: `chk_${input.bookingRef}`,
      checkoutId: `chk_${input.bookingRef}`,
      provider: this.name,
    };
  }
  async verifyWebhook(): Promise<PaymentEvent> {
    throw new Error('not used by this route');
  }
  async getCheckoutStatus(): Promise<PaymentEvent> {
    throw new Error('not used by this route');
  }
}

describe('POST /api/v1/admin/quotes/:ref/balance', () => {
  let db: TestDb;
  let seq = 0;

  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  /**
   * A sent quote with one custom line summing to `totalMinor`, converted through the real RPC and its
   * DEPOSIT settled — exactly the state "Send balance link" is pressed against: a confirmed quote
   * booking that still owes its balance (or, for deposit_bps = 10000, owes nothing).
   */
  async function depositConfirmed(
    totalMinor: number,
    depositBps: number,
    internalNotes: string | null = 'Margin is thin — do not discount further.',
  ): Promise<{ quoteRef: string; bookingRef: string }> {
    seq += 1;
    const quoteRef = `QBALR${seq}`;
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, status, valid_until, total_minor,
                           deposit_bps, internal_notes, sent_at)
       values ($1, 'Marie Dupont', $2, 'sent', current_date + 7, $3, $4, $5, now()) returning id`,
      [quoteRef, `balr${seq}@example.com`, totalMinor, depositBps, internalNotes],
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
    // Mint + settle the DEPOSIT the accountless way — the confirm-on-paid gate flips the booking to
    // 'confirmed' and append_payment_event recomputes balance_due_minor (total - deposit, or 0 for a
    // pay-in-full quote).
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

  /** Invoke the route as the cron/operator would, with the ambient session as owner for the shim reads. */
  async function sendBalance(
    ref: string,
    bearer: string | null = 'admin-token',
  ): Promise<Response> {
    await db.asOwner();
    const headers = new Headers({ 'content-type': 'application/json' });
    if (bearer) headers.set('authorization', `Bearer ${bearer}`);
    return POST(
      new Request(`https://x/api/v1/admin/quotes/${ref}/balance`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ ref }) },
    );
  }

  /** Count of the 'balance' payments rows on this booking, read as the owner. */
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
    await db.asOwner();

    await db.pg.query(`insert into auth.users (id) values ($1), ($2), ($3), ($4), ($5)`, [
      ADMIN,
      STAFF,
      CUSTOMER,
      SEO,
      NO_PROFILE,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role)
       values ($1, 'Owner', 'admin'), ($2, 'Guide', 'staff'), ($3, 'Guest', 'customer'),
              ($4, 'SEO hire', 'seo')`,
      [ADMIN, STAFF, CUSTOMER, SEO],
    );
    hoisted.users.set('admin-token', ADMIN);
    hoisted.users.set('staff-token', STAFF);
    hoisted.users.set('customer-token', CUSTOMER);
    hoisted.users.set('seo-token', SEO);
    hoisted.users.set('no-profile-token', NO_PROFILE);

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
    await db.asOwner();
  });

  // ── The staff gate ────────────────────────────────────────────────────────
  it('refuses a caller with no bearer token', async () => {
    const { quoteRef, bookingRef } = await depositConfirmed(100000, 1000);
    expect((await sendBalance(quoteRef, null)).status).toBe(401);
    expect(await balanceRowCount(bookingRef)).toBe(0);
  });

  it('refuses a signed-in customer — the JWT role claim is not the business role', async () => {
    // THE TRAP: `requireUser().role` is 'authenticated' for staff and customer alike, so a gate
    // written against it would let this through and mint a stranger's balance checkout.
    const { quoteRef, bookingRef } = await depositConfirmed(100000, 1000);
    expect((await sendBalance(quoteRef, 'customer-token')).status).toBe(403);
    expect(await balanceRowCount(bookingRef)).toBe(0);
  });

  it('refuses a signed-in user with no profile row at all', async () => {
    const { quoteRef } = await depositConfirmed(100000, 1000);
    expect((await sendBalance(quoteRef, 'no-profile-token')).status).toBe(403);
  });

  it('refuses the SEO hire — a quote carries the guest’s name, email and margin note', async () => {
    const { quoteRef } = await depositConfirmed(100000, 1000);
    expect((await sendBalance(quoteRef, 'seo-token')).status).toBe(403);
  });

  it('admits a staff account, not only an admin', async () => {
    const { quoteRef } = await depositConfirmed(100000, 1000);
    const res = await sendBalance(quoteRef, 'staff-token');
    expect(res.status).toBe(200);
    expect((await res.json()).data.url).toBeTruthy();
  });

  it('answers 404 for a quote that does not exist', async () => {
    expect((await sendBalance('QNOPE404')).status).toBe(404);
  });

  // ── The mint itself ───────────────────────────────────────────────────────
  it('returns the balance checkout’s public payment URL for the copy button', async () => {
    const { quoteRef, bookingRef } = await depositConfirmed(100000, 1000); // EUR 1000, 10% deposit

    const res = await sendBalance(quoteRef);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // The public hosted-checkout URL the operator copies. The dev stub bounces the guest back to the
    // quote page (the returnUrl), so the URL is anchored to this quote and carries the live session.
    expect(typeof body.data.url).toBe('string');
    expect(body.data.url.startsWith(`${SITE.url}/quotes/${quoteRef}`)).toBe(true);
    expect(body.data.url).toContain('stub_session');

    // …and a real 'balance' row was minted, sized to the amount still owed (total - deposit).
    expect(await balanceRowCount(bookingRef)).toBe(1);
    const { rows } = await db.pg.query<{ amount: string; owed: string }>(
      `select p.amount_minor as amount, b.balance_due_minor as owed
         from payments p join bookings b on b.id = p.booking_id
        where b.ref = $1 and p.purpose = 'balance'`,
      [bookingRef],
    );
    expect(Number(rows[0]!.amount)).toBe(90000);
    // The balance is not settled by minting the link, so the booking still owes it.
    expect(Number(rows[0]!.owed)).toBe(90000);
  });

  it('refuses a fully-paid booking — nothing is owed, so no balance link is minted', async () => {
    // A pay-in-full quote (deposit_bps = 10000): the deposit IS the whole total, so balance_due_minor
    // reaches 0 the moment it settles. There is nothing to collect, so the route refuses with a 409
    // and does NOT open a balance checkout.
    const { quoteRef, bookingRef } = await depositConfirmed(100000, 10000);
    const res = await sendBalance(quoteRef);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/fully paid|nothing (is )?owed|no balance/i);
    expect(await balanceRowCount(bookingRef)).toBe(0);
  });

  it('never surfaces the staff-only internal note in its response', async () => {
    const secret = 'SECRET-MARGIN-DO-NOT-SHARE';
    const { quoteRef } = await depositConfirmed(100000, 1000, secret);
    const res = await sendBalance(quoteRef);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain(secret);
  });

  // ── The URL handed to the operator, on the PRODUCTION provider ─────────────
  it('builds an embedded-widget pay URL from the checkoutId when the provider returns no redirectUrl (Peach)', async () => {
    // Production runs Peach, an embedded-widget provider whose createCheckout returns a checkoutId and
    // NO redirectUrl. Keying the response on redirectUrl 409s every real mint ("generated moments ago
    // and is still live"), because only the dev stub ever populates redirectUrl. The operator's
    // copyable URL must instead mount the widget at /bookings/{ref}/pay?cid=…, exactly as the DEPOSIT
    // guest is sent there (src/lib/quotes/pay-client.ts), with return= pointing back at the quote page.
    const { quoteRef, bookingRef } = await depositConfirmed(100000, 1000);

    setRouteContext({
      db: pgliteServiceRoleRpc(db.pg),
      payments: new PeachLikeProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    });
    let res: Response | null = null;
    try {
      res = await sendBalance(quoteRef);
    } finally {
      // Restore the stub provider so the remaining tests are unaffected.
      setRouteContext({
        db: pgliteServiceRoleRpc(db.pg),
        payments: new StubPaymentProvider(),
        ai: createStubAiProvider(),
        now: () => new Date(),
        locale: 'en',
      });
    }

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body.ok).toBe(true);
    // The exact URL the deposit flow builds for an embedded session: absolute, the booking's pay page,
    // the minted checkout id, and return= back to this quote page.
    expect(body.data.url).toBe(
      `${SITE.url}/bookings/${bookingRef}/pay?cid=chk_${bookingRef}` +
        `&return=${encodeURIComponent(`/quotes/${quoteRef}`)}`,
    );
  });
});
