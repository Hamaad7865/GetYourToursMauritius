import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { pgliteServiceRoleRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { hashQuoteToken } from '@/lib/quotes/token';
import { SITE } from '@/lib/seo/site';

/**
 * POST /api/v1/admin/quotes/:ref/balance — the operator's "Send balance link" button (Task 5 of the
 * quote-deposit plan; src/lib/admin/quotes.ts `sendBalanceLink`), in its DURABLE form.
 *
 * The deposit confirms the booking and reserves the seat; the balance is chased later by hand. This
 * route used to mint the balance CHECKOUT at send time (a ~30-minute Peach session that died within the
 * hour, leaving an accountless guest with a dead link). It now mints a DURABLE balance-link TOKEN
 * instead, stores only its SHA-256 in `quotes.balance_token_hash`, and returns
 * /quotes/{ref}/balance?t=<rawToken> — the guest's own page mints the checkout FRESH on the click, so
 * the URL works for as long as the balance is owed.
 *
 * What is asserted here:
 *   - THE STAFF GATE. `requireUser().role` is the JWT's Postgres role selector ('authenticated' for
 *     staff and customer alike), never the business role, so the check runs against real `profiles`
 *     rows: no bearer → 401, a signed-in customer / the SEO hire / no-profile → 403, admin AND staff
 *     admitted.
 *   - SUCCESS returns { url } = the DURABLE /quotes/{ref}/balance?t=<token> page URL, and stores
 *     hashQuoteToken(token) in `balance_token_hash` — the token round-trips.
 *   - IT DOES NOT ROTATE `token_hash` (the deposit/quote link's hash): the guest's original link keeps
 *     working.
 *   - IT MINTS NO CHECKOUT: no `balance` payments row is created at send time (that happens on the
 *     guest's click, in a different route).
 *   - NOTHING OWED → 409, and NO token is written. A pay-in-full quote (deposit_bps = 10000) is fully
 *     paid the moment its deposit settles.
 *   - THE STAFF-ONLY MARGIN NOTE never leaks: quotes.internal_notes appears nowhere in the response.
 *
 * `requireUser` is faked (the JWT itself is covered elsewhere); the STAFF check is not — the trap it
 * avoids (reading the JWT's Postgres-role claim as the business role) cannot be caught by a mock that
 * hands back a business role nobody uses.
 */

const ADMIN = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const STAFF = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const CUSTOMER = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
const SEO = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
const NO_PROFILE = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';

/** A sentinel deposit/quote-link hash seeded on every quote, so a test can prove it is left untouched. */
const DEPOSIT_TOKEN_HASH = 'd'.repeat(64);

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
   * booking that still owes its balance (or, for deposit_bps = 10000, owes nothing). A sentinel
   * `token_hash` is seeded so a test can prove the balance flow never touches it.
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
                           deposit_bps, internal_notes, token_hash, sent_at)
       values ($1, 'Marie Dupont', $2, 'sent', current_date + 7, $3, $4, $5, $6, now()) returning id`,
      [
        quoteRef,
        `balr${seq}@example.com`,
        totalMinor,
        depositBps,
        internalNotes,
        DEPOSIT_TOKEN_HASH,
      ],
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

  /** Invoke the route as the operator would, with the ambient session as owner for the shim reads. */
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

  /** The two link hashes on a quote, read as the owner. */
  async function tokenHashes(
    quoteRef: string,
  ): Promise<{ tokenHash: string | null; balanceTokenHash: string | null }> {
    await db.asOwner();
    const { rows } = await db.pg.query<{
      token_hash: string | null;
      balance_token_hash: string | null;
    }>(`select token_hash, balance_token_hash from quotes where ref = $1`, [quoteRef]);
    return { tokenHash: rows[0]!.token_hash, balanceTokenHash: rows[0]!.balance_token_hash };
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
    const { quoteRef } = await depositConfirmed(100000, 1000);
    expect((await sendBalance(quoteRef, null)).status).toBe(401);
    expect((await tokenHashes(quoteRef)).balanceTokenHash).toBeNull();
  });

  it('refuses a signed-in customer — the JWT role claim is not the business role', async () => {
    // THE TRAP: `requireUser().role` is 'authenticated' for staff and customer alike, so a gate
    // written against it would let this through and mint a stranger's balance link.
    const { quoteRef } = await depositConfirmed(100000, 1000);
    expect((await sendBalance(quoteRef, 'customer-token')).status).toBe(403);
    expect((await tokenHashes(quoteRef)).balanceTokenHash).toBeNull();
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

  // ── The durable link it mints ──────────────────────────────────────────────
  it('returns the durable /quotes/{ref}/balance?t=<token> URL and stores its hash', async () => {
    const { quoteRef, bookingRef } = await depositConfirmed(100000, 1000); // EUR 1000, 10% deposit

    const res = await sendBalance(quoteRef);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // The durable balance PAGE URL, carrying the raw token — NOT a /bookings pay URL with a checkout id.
    const url: string = body.data.url;
    expect(url.startsWith(`${SITE.url}/quotes/${quoteRef}/balance?t=`)).toBe(true);
    const token = new URL(url).searchParams.get('t')!;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // The token round-trips: its SHA-256 is what landed in balance_token_hash.
    const { balanceTokenHash } = await tokenHashes(quoteRef);
    expect(balanceTokenHash).toBe(await hashQuoteToken(token));

    // NO checkout was minted at send time — that is now the guest's click, in a different route.
    expect(await balanceRowCount(bookingRef)).toBe(0);
  });

  it('does NOT rotate token_hash — the guest’s original quote link keeps working', async () => {
    const { quoteRef } = await depositConfirmed(100000, 1000);
    const before = await tokenHashes(quoteRef);
    expect(before.tokenHash).toBe(DEPOSIT_TOKEN_HASH);

    const res = await sendBalance(quoteRef);
    expect(res.status).toBe(200);

    const after = await tokenHashes(quoteRef);
    // The deposit/quote link's hash is untouched; only the balance link's hash was written.
    expect(after.tokenHash).toBe(DEPOSIT_TOKEN_HASH);
    expect(after.balanceTokenHash).not.toBeNull();
    expect(after.balanceTokenHash).not.toBe(DEPOSIT_TOKEN_HASH);
  });

  it('a re-send rotates the balance token (one hash per column, like the deposit link)', async () => {
    const { quoteRef } = await depositConfirmed(100000, 1000);
    const first = new URL((await (await sendBalance(quoteRef)).json()).data.url).searchParams.get(
      't',
    );
    const firstHash = (await tokenHashes(quoteRef)).balanceTokenHash;
    const second = new URL((await (await sendBalance(quoteRef)).json()).data.url).searchParams.get(
      't',
    );
    const secondHash = (await tokenHashes(quoteRef)).balanceTokenHash;

    expect(second).not.toBe(first);
    expect(secondHash).not.toBe(firstHash);
    expect(secondHash).toBe(await hashQuoteToken(second!));
  });

  it('refuses a fully-paid booking — nothing is owed, so no link is minted', async () => {
    // A pay-in-full quote (deposit_bps = 10000): the deposit IS the whole total, so balance_due_minor
    // reaches 0 the moment it settles. There is nothing to collect, so the route refuses with a 409 and
    // writes NO balance token.
    const { quoteRef } = await depositConfirmed(100000, 10000);
    const res = await sendBalance(quoteRef);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/fully paid|nothing (is )?owed|no balance/i);
    expect((await tokenHashes(quoteRef)).balanceTokenHash).toBeNull();
  });

  it('never surfaces the staff-only internal note in its response', async () => {
    const secret = 'SECRET-MARGIN-DO-NOT-SHARE';
    const { quoteRef } = await depositConfirmed(100000, 1000, secret);
    const res = await sendBalance(quoteRef);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain(secret);
  });
});
