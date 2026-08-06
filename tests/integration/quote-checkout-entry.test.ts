import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';
import { apiBook } from '../db/book';

/**
 * api_create_quote_payment — the quote path's own way into the checkout (migration 20260911000000).
 *
 * THE PROBLEM IT SOLVES. api_create_payment ends its guard with
 *   `if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid()))`
 * which is exactly right for the customer checkout: the public booking ref is not a bearer credential,
 * so only the booking's owner (or staff) may open a payable session for it. A QUOTE booking has
 * `user_id` null — the guest has no account, which is the whole point of an emailed offer — and the pay
 * route calls as service_role, for which auth.uid() is null. Every quote payment was therefore refused
 * (`forbidden` → 403) and the module was non-functional end to end.
 *
 * THE SHAPE OF THE FIX, and what these tests hold in place:
 *   1. the customer guard is UNTOUCHED. api_create_payment keeps refusing a booking the caller does
 *      not own — the last describe block here is that promise, restated against the real function;
 *   2. the quote entry point is a SEPARATE, service-role-only function. Authorization for a quote comes
 *      from the LINK TOKEN (resolveQuoteForToken, before the route ever reaches SQL), so this function
 *      must be unreachable from a browser: anon and authenticated cannot execute it at all;
 *   3. it is narrowed to the quote path even for a server caller — a booking with no `quotes` row
 *      pointing at it is refused, so the identity bypass can never be pointed at a normal customer's
 *      booking;
 *   4. and, the load-bearing one: BOTH entry points share ONE body, so they take THE SAME single-flight
 *      checkout lease. That lease is what stops a booking having two payable Peach sessions (Peach's
 *      nonce is per-request and never dedupes), a defect this repo shipped once already — a declined
 *      card forked a second session (ec5ebcf). Copying the lease into a second function would leave two
 *      copies free to drift; the cross-entry-point test below is what proves they did not.
 */

const ALICE = 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7';
const BOB = 'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7';
const STAFF = 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7';

interface CreatePaymentOut {
  paymentId: string;
  bookingRef: string;
  amountMinor: number;
  existingCheckoutId: string | null;
  checkoutPending?: boolean | null;
  chargedAmountMinor?: number | null;
  chargedCurrency?: string | null;
}

describe('api_create_quote_payment', () => {
  let db: TestDb;
  let seq = 0;

  /** Call an RPC as whatever role the session currently holds — grants are part of what is tested. */
  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  /**
   * A sent quote with one custom line, converted through the real api_convert_quote — so the booking
   * under test is exactly what a guest clicking "Accept & pay" produces: `source = 'quote'`,
   * `payment_pending`, and `user_id` NULL.
   */
  async function convertedQuoteBooking(): Promise<{ ref: string; quoteId: string }> {
    seq += 1;
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, customer_phone, status, valid_until,
                           total_minor, sent_at)
       values ($1, 'Marie Dupont', $2, '+230 5555 1234', 'sent', current_date + 7, 12000, now())
       returning id`,
      [`QENTRY${seq}`, `marie${seq}@example.com`],
    );
    const quoteId = rows[0]!.id;
    await db.pg.query(
      `insert into quote_items (quote_id, position, kind, description, starts_at, quantity,
                                unit_amount_minor, subtotal_minor)
       values ($1, 1, 'custom', 'Private guide, full day', now() + interval '10 days', 1, 12000, 12000)`,
      [quoteId],
    );
    await db.as({ role: 'service_role' });
    const booking = await call<{ ref: string }>('api_convert_quote', { quoteId });
    return { ref: booking.ref, quoteId };
  }

  async function paymentRowCount(bookingRef: string): Promise<number> {
    const prev = (
      await db.pg.query<{ claims: string | null; role: string }>(
        `select current_setting('request.jwt.claims', true) as claims, current_user as role`,
      )
    ).rows[0]!;
    await db.asOwner();
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from payments p join bookings b on b.id = p.booking_id
        where b.ref = $1`,
      [bookingRef],
    );
    if (prev.role === 'anon' || prev.role === 'authenticated' || prev.role === 'service_role') {
      await db.as({
        ...(prev.claims ? (JSON.parse(prev.claims) as Record<string, unknown>) : {}),
        role: prev.role,
      });
    }
    return rows[0]!.n;
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2), ($3)`, [ALICE, BOB, STAFF]);
    await db.pg.query(
      `insert into profiles (id, role) values ($1, 'customer'), ($2, 'customer'), ($3, 'admin')`,
      [ALICE, BOB, STAFF],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('opens a checkout for an ownerless quote booking that api_create_payment refuses', async () => {
    const { ref } = await convertedQuoteBooking();

    // The refusal that made the whole feature non-functional, restated so the fix is measured against
    // it rather than against a description of it. Same booking, same caller, one function apart.
    await db.as({ role: 'service_role' });
    await expect(
      call('api_create_payment', { bookingRef: ref, idempotencyKey: 'k' }),
    ).rejects.toThrow(/forbidden/);

    const out = await call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: 'quote-entry-1',
    });

    expect(out.bookingRef).toBe(ref);
    expect(out.amountMinor).toBe(12000);
    expect(out.existingCheckoutId).toBeNull();
    expect(out.checkoutPending ?? null).toBeNull();
    // The charge is pinned by the SHARED body, so a quote pays in the same currency as everyone else.
    expect(out.chargedCurrency).toBe('MUR');
    expect(await paymentRowCount(ref)).toBe(1);
  });

  it('is not callable by anon or by a signed-in customer — service_role only', async () => {
    // Authorization for a quote is the LINK TOKEN, checked in the route before this is reached. That is
    // only sound while nothing reachable from a browser can call this function directly: `authenticated`
    // holding it would be an identity-check bypass for any quote booking whose ref leaked (refs travel
    // in forwarded emails). `revoke from public` alone does NOT strip Supabase's stock direct grants —
    // the omission that has shipped a live hole from this repo three times.
    const { ref } = await convertedQuoteBooking();

    await db.as(null);
    await expect(
      call('api_create_quote_payment', { bookingRef: ref, idempotencyKey: 'anon' }),
    ).rejects.toThrow(/permission denied/);

    await db.as({ sub: BOB, role: 'authenticated' });
    await expect(
      call('api_create_quote_payment', { bookingRef: ref, idempotencyKey: 'bob' }),
    ).rejects.toThrow(/permission denied/);

    expect(await paymentRowCount(ref)).toBe(0);
  });

  it('refuses a booking no quote points at — the bypass covers the quote path and nothing else', async () => {
    // Defence in depth behind the grant: even a server-side caller cannot aim the identity bypass at an
    // ordinary customer's booking, whose owner is the only person entitled to open a session for it.
    await db.asOwner();
    const { occurrenceId } = await seedOccurrence(db, 8);
    await db.as({ sub: ALICE, role: 'authenticated' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      party: { Adult: 2 },
      customerName: 'Alice',
      customerEmail: 'alice@example.com',
      source: 'web',
      idempotencyKey: 'entry-web-1',
    });

    await db.as({ role: 'service_role' });
    await expect(
      call('api_create_quote_payment', { bookingRef: booking.ref, idempotencyKey: 'nope' }),
    ).rejects.toThrow(/forbidden/);
    expect(await paymentRowCount(booking.ref)).toBe(0);
  });

  it('two calls for one quote yield ONE payable session, never two', async () => {
    const { ref } = await convertedQuoteBooking();
    await db.as({ role: 'service_role' });

    // Two tabs, or a double-click on "Accept & pay". The winner holds the single-flight lease; the
    // loser is told to wait rather than being sent to Peach for a second, independently payable
    // session. Different idempotency keys on purpose — the lease, not the key, is what serialises this.
    const first = await call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: 'race-a',
    });
    const second = await call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: 'race-b',
    });

    expect(first.checkoutPending ?? null).toBeNull();
    expect(first.existingCheckoutId).toBeNull();
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.checkoutPending).toBe(true);
    expect(second.existingCheckoutId).toBeNull();
    expect(await paymentRowCount(ref)).toBe(1);

    // Once the winner's session is recorded the lease clears and everyone REUSES that one session.
    await db.as({ role: 'service_role' });
    await call('api_record_payment_checkout', {
      paymentId: first.paymentId,
      checkoutId: 'chk_quote_race',
    });
    const third = await call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: 'race-c',
    });
    expect(third.existingCheckoutId).toBe('chk_quote_race');
    expect(third.checkoutPending ?? null).toBeNull();
    expect(await paymentRowCount(ref)).toBe(1);
  });

  it('shares ONE lease with api_create_payment — the two entry points cannot drift apart', async () => {
    // The reason the fix is a shared body rather than a second function that re-implements the guards.
    // Staff can reach a quote booking through api_create_payment (the is_staff branch), so both entry
    // points are live on this one booking at once: an owner opening it in the admin while the guest
    // clicks Pay. If each held its own lease, that is two payable Peach sessions on one booking — the
    // exact double-charge the lease exists to prevent.
    const { ref } = await convertedQuoteBooking();

    await db.as({ sub: STAFF, role: 'authenticated' });
    const staff = await call<CreatePaymentOut>('api_create_payment', {
      bookingRef: ref,
      idempotencyKey: 'staff-1',
    });
    expect(staff.checkoutPending ?? null).toBeNull();

    await db.as({ role: 'service_role' });
    const guest = await call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: 'guest-1',
    });

    expect(guest.paymentId).toBe(staff.paymentId); // one payment row…
    expect(guest.checkoutPending).toBe(true); // …one lease, and the staff caller holds it
    expect(await paymentRowCount(ref)).toBe(1);
  });
});

describe('api_create_payment is unchanged for a normal signed-in customer', () => {
  let db: TestDb;
  let bookingRef: string;

  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [ALICE, BOB]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer'), ($2, 'customer')`, [
      ALICE,
      BOB,
    ]);
    const { occurrenceId } = await seedOccurrence(db, 8);
    await db.as({ sub: ALICE, role: 'authenticated' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      party: { Adult: 2 },
      customerName: 'Alice',
      customerEmail: 'alice@example.com',
      source: 'web',
      idempotencyKey: 'owner-book-1',
    });
    bookingRef = booking.ref;
  });

  afterAll(async () => {
    await db.close();
  });

  it('the owner still gets a claim, and the charge is still pinned in MUR', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const out = await call<CreatePaymentOut>('api_create_payment', {
      bookingRef,
      idempotencyKey: 'owner-pay-1',
    });
    expect(out.bookingRef).toBe(bookingRef);
    expect(out.existingCheckoutId).toBeNull();
    expect(out.checkoutPending ?? null).toBeNull();
    expect(out.chargedCurrency).toBe('MUR');
  });

  it('another signed-in customer is still refused — the public ref is not a bearer credential', async () => {
    await db.as({ sub: BOB, role: 'authenticated' });
    await expect(
      call('api_create_payment', { bookingRef, idempotencyKey: 'bob-1' }),
    ).rejects.toThrow(/forbidden/);
  });

  it('anon still cannot execute it at all', async () => {
    await db.as(null);
    await expect(
      call('api_create_payment', { bookingRef, idempotencyKey: 'anon-1' }),
    ).rejects.toThrow(/permission denied/);
  });
});
