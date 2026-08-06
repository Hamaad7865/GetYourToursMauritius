import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { pgliteServiceRoleRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { hashQuoteToken, mintQuoteToken } from '@/lib/quotes/token';
import { QUOTE_TOKEN_COOKIE } from '@/lib/quotes/link-cookie';

/**
 * WHO OWNS A QUOTE BOOKING — and how the guest who never signs up still reaches their record.
 *
 * Every booking in production carries a `user_id`; a quote booking is the first ownerless one, because
 * the guest has no account by design. The bookings RLS policy is
 * `using (user_id = auth.uid() or is_staff())`, and `null = auth.uid()` is NULL, not true — so neither
 * branch matches and a PAID quote booking is invisible to every customer forever, including the guest
 * who paid for it. That is not a cosmetic gap: /bookings/{ref} is the page the confirmation email's
 * e-voucher button points at, and it is guarded by that policy.
 *
 * The owner's decision, and what this file pins:
 *
 *   1. AT PAYMENT, match by email — case-insensitively, and ONLY against a CONFIRMED account. An
 *      unconfirmed signup must never become a way to claim a stranger's booking by registering their
 *      address.
 *   2. NO MATCH IS NOT AN ERROR. `user_id` stays null, and the booking is still payable and still
 *      reachable through the quote link. Most guests will never sign up.
 *   3. CLAIMING LATER is idempotent and only ever moves a booking from NULL to a user — never from one
 *      user to another.
 *   4. A LATER CLAIM matches the claimer's OWN confirmed email. Never an address they typed.
 *   5. THE GUEST WHO NEVER SIGNS UP still reaches their record, through the same link token that
 *      authorised the payment — and an invalid token still reaches nothing.
 *   6. ERASURE STILL REACHES THESE BOOKINGS. It matches on email as well as user id, so an ownerless
 *      one is in scope; that is asserted here rather than assumed.
 *
 * THE ACCEPTED RISK, stated so nobody re-derives it as a bug: a mistyped address that belongs to a real
 * confirmed account attaches that booking to the wrong person. The same typo already emailed them the
 * offer, so the first disclosure happens either way — which is exactly why matching must never widen
 * beyond a confirmed, exact (case-insensitive) address.
 */

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
    serviceRoleServiceContext: () => mod.requireRouteContext(),
  };
});

const { GET: RECEIPT } = await import('../../app/api/v1/quotes/[ref]/receipt/route');

/** A confirmed account: the only kind the match may ever attach a booking to. */
const GUEST = '11111111-1111-1111-1111-111111111111';
const GUEST_EMAIL = 'anouk.leclerc@example.com';
/**
 * An account that registered an address and never confirmed it — and the ONLY account holding that
 * address, so nothing but the confirmation rule stands between it and the booking. The impersonation
 * shape rule 1 exists to refuse.
 */
const IMPOSTOR = '22222222-2222-2222-2222-222222222222';
const IMPOSTOR_EMAIL = 'targeted.guest@example.com';
/** A different, confirmed person. Their bookings must never move. */
const STRANGER = '33333333-3333-3333-3333-333333333333';
const STRANGER_EMAIL = 'other.person@example.com';
/** Confirmed, and the address a booking gets re-pointed at in the "never re-assigns" test. */
const THIEF = '99999999-9999-9999-9999-999999999999';
const THIEF_EMAIL = 'opportunist@example.com';
const STAFF = '44444444-4444-4444-4444-444444444444';

interface SeededQuote {
  id: string;
  ref: string;
  token: string;
  email: string;
}

describe('a quote booking gets an owner', () => {
  let db: TestDb;
  let seq = 0;

  /** service_role, the way the pay route calls: `api_convert_quote` is granted to nothing else. */
  async function rpc<T>(fn: string, payload: Record<string, unknown>): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(payload),
    ]);
    return rows[0]!.data;
  }

  /** A SENT quote with one custom line and a live link token, exactly as the send route leaves it. */
  async function seedQuote(email: string, amountMinor = 12_000): Promise<SeededQuote> {
    seq += 1;
    const ref = `QOWN${seq}`;
    const token = mintQuoteToken();
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, customer_phone, status, valid_until,
                           total_minor, token_hash, sent_at)
       values ($1, 'Anouk Leclerc', $2, '+230 5555 4321', 'sent', current_date + 7, $3, $4, now())
       returning id`,
      [ref, email, amountMinor, await hashQuoteToken(token)],
    );
    const id = rows[0]!.id;
    await db.pg.query(
      `insert into quote_items (quote_id, position, kind, description, starts_at, quantity,
                                unit_amount_minor, subtotal_minor)
       values ($1, 1, 'custom', 'Private catamaran, full day', now() + interval '10 days', 1, $2, $2)`,
      [id, amountMinor],
    );
    return { id, ref, token, email };
  }

  /** Convert as the pay route does, and hand back the minted booking's id + ref. */
  async function convert(quote: SeededQuote): Promise<{ id: string; ref: string }> {
    await db.as({ role: 'service_role' });
    const booking = await rpc<{ id: string; ref: string }>('api_convert_quote', {
      quoteId: quote.id,
    });
    await db.asOwner();
    return booking;
  }

  async function ownerOf(bookingId: string): Promise<string | null> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ user_id: string | null }>(
      `select user_id from bookings where id = $1`,
      [bookingId],
    );
    return rows[0]!.user_id;
  }

  /** Can this signed-in account SEE the booking through the RLS policy? The point of the whole task. */
  async function visibleTo(userId: string, bookingId: string): Promise<boolean> {
    await db.as({ sub: userId, role: 'authenticated' });
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from bookings where id = $1`,
      [bookingId],
    );
    await db.asOwner();
    return rows[0]!.n === 1;
  }

  /** Mark the booking paid the way the ledger does, so the receipt/erasure branches are the real ones. */
  async function markPaid(bookingId: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(
      `update bookings set status = 'confirmed', payment_state = 'paid' where id = $1`,
      [bookingId],
    );
  }

  beforeAll(async () => {
    db = await createTestDb();
    hoisted.shim = makeSupabaseShim(db.pg);
    await db.asOwner();
    await db.pg.query(
      `insert into auth.users (id, email, email_confirmed_at) values
         ($1, $2, now()), ($3, $4, null), ($5, $6, now()), ($7, $8, now()),
         ($9, 'ops@example.com', now())`,
      [
        GUEST,
        GUEST_EMAIL,
        IMPOSTOR,
        IMPOSTOR_EMAIL,
        STRANGER,
        STRANGER_EMAIL,
        THIEF,
        THIEF_EMAIL,
        STAFF,
      ],
    );
    await db.pg.query(
      `insert into profiles (id, role) values
         ($1, 'customer'), ($2, 'customer'), ($3, 'customer'), ($4, 'customer'), ($5, 'admin')`,
      [GUEST, IMPOSTOR, STRANGER, THIEF, STAFF],
    );

    setRouteContext({
      db: pgliteServiceRoleRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date('2026-08-06T12:00:00Z'),
      locale: 'en',
    });
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  // ── 1. At conversion ──────────────────────────────────────────────────────────────────────────

  it('attaches the booking to the CONFIRMED account holding the quoted address', async () => {
    // Case-insensitively: the operator types the address into the quote editor by hand, and
    // "Anouk.Leclerc@Example.com" is the same mailbox as the one the account was opened with. A
    // case-sensitive compare would leave most real matches ownerless for no reason anyone could see.
    const quote = await seedQuote(GUEST_EMAIL.toUpperCase());
    const booking = await convert(quote);

    expect(await ownerOf(booking.id), 'the quote booking was minted ownerless').toBe(GUEST);
    // The whole point: `using (user_id = auth.uid() or is_staff())` now has a branch that matches, so
    // the guest can open /bookings/{ref} — the page the confirmation email sends them to.
    expect(
      await visibleTo(GUEST, booking.id),
      'the guest cannot see the booking they paid for',
    ).toBe(true);
    expect(await visibleTo(STRANGER, booking.id), 'the booking leaked to another account').toBe(
      false,
    );
  });

  it('refuses to attach to an UNCONFIRMED account holding that address', async () => {
    // The impersonation route this rule closes: sign up with a stranger's address, never confirm it
    // (you cannot — the mail goes to them), and collect their booking. IMPOSTOR is the ONLY account
    // holding this address, so `email_confirmed_at is not null` is the single thing standing between
    // them and it — the whole of the difference between an address someone TYPED and one they hold.
    const quote = await seedQuote(IMPOSTOR_EMAIL);
    const booking = await convert(quote);

    expect(
      await ownerOf(booking.id),
      "an unconfirmed signup was handed a stranger's booking",
    ).toBeNull();
    expect(await visibleTo(IMPOSTOR, booking.id)).toBe(false);

    // …and the claim path refuses it too, or the rule would only hold for half a minute.
    await db.as({ sub: IMPOSTOR, role: 'authenticated' });
    const result = await rpc<{ claimed: number }>('api_claim_quote_bookings', {});
    await db.asOwner();
    expect(result.claimed).toBe(0);
    expect(await ownerOf(booking.id)).toBeNull();
  });

  it('leaves the booking OWNERLESS, payable and payment_pending when nobody holds the address', async () => {
    // Ownerless is a valid state, not a failure: most quote guests never sign up. The booking must
    // still convert, still be payment_pending, and still open a checkout through the quote entry point.
    const quote = await seedQuote('never-signed-up@example.com');
    const booking = await convert(quote);

    expect(await ownerOf(booking.id)).toBeNull();

    await db.asOwner();
    const { rows } = await db.pg.query<{ status: string; payment_state: string }>(
      `select status, payment_state from bookings where id = $1`,
      [booking.id],
    );
    expect(rows[0]!.status).toBe('payment_pending');
    expect(rows[0]!.payment_state).toBe('pending');

    await db.as({ role: 'service_role' });
    const checkout = await rpc<{ paymentId: string; amountMinor: number }>(
      'api_create_quote_payment',
      { bookingRef: booking.ref, idempotencyKey: `ownerless-${booking.ref}` },
    );
    await db.asOwner();
    expect(checkout.paymentId, 'an ownerless quote booking could not open a checkout').toBeTruthy();
    // Sized to the default 10% deposit (deposit_bps = 1000, 20260912000000 Task 2), not the 12000
    // total: a converted quote now takes a deposit that confirms the booking, with the balance chased
    // later. The subject of this test is that an OWNERLESS booking can open a checkout at all.
    expect(checkout.amountMinor).toBe(1_200);
  });

  it('refuses to guess when two CONFIRMED accounts hold the same address', async () => {
    // auth.users does not constrain email to be unique, and attaching to "the oldest" would be a
    // coin toss on a money record. Ownerless is already a supported state, so this fails closed into it.
    const twinA = '55555555-5555-5555-5555-555555555555';
    const twinB = '66666666-6666-6666-6666-666666666666';
    await db.asOwner();
    await db.pg.query(
      `insert into auth.users (id, email, email_confirmed_at) values ($1, $3, now()), ($2, $3, now())`,
      [twinA, twinB, 'twins@example.com'],
    );

    const quote = await seedQuote('twins@example.com');
    const booking = await convert(quote);

    expect(
      await ownerOf(booking.id),
      'an ambiguous address was attached to one of the two',
    ).toBeNull();
  });

  // ── 2. Claiming later ─────────────────────────────────────────────────────────────────────────

  it('claims the ownerless booking for the account that later confirms that address', async () => {
    const quote = await seedQuote('late.signup@example.com');
    const booking = await convert(quote);
    expect(await ownerOf(booking.id)).toBeNull();

    // They sign up afterwards, with the address the quote was sent to, and confirm it.
    const late = '77777777-7777-7777-7777-777777777777';
    await db.asOwner();
    await db.pg.query(
      `insert into auth.users (id, email, email_confirmed_at) values ($1, 'Late.Signup@Example.com', now())`,
      [late],
    );
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [late]);

    await db.as({ sub: late, role: 'authenticated' });
    const result = await rpc<{ claimed: number }>('api_claim_quote_bookings', {});
    await db.asOwner();

    expect(result.claimed).toBe(1);
    expect(await ownerOf(booking.id)).toBe(late);
    expect(await visibleTo(late, booking.id)).toBe(true);

    // Idempotent: the claim runs on every sign-in, so a second pass must be a no-op, not a re-write.
    await db.as({ sub: late, role: 'authenticated' });
    const again = await rpc<{ claimed: number }>('api_claim_quote_bookings', {});
    await db.asOwner();
    expect(again.claimed).toBe(0);
    expect(await ownerOf(booking.id)).toBe(late);
  });

  it('claims an address stored with the whitespace it was pasted in with', async () => {
    // THE TWO MATCHERS MUST NORMALISE IDENTICALLY, or an address that works at payment can never be
    // claimed afterwards. The operator copies the address out of a mail client and a space comes with
    // it; `quotes.customer_email` has no trigger trimming it, and api_convert_quote copies the column
    // into `bookings.customer_email` VERBATIM. So the stored booking address really can carry
    // whitespace, and it looks identical to a correct one on every screen — which is precisely what
    // makes an asymmetry here unreproducible later.
    //
    // Half 1: conversion normalises. quote_owner_for_email btrims, so the padded address finds the
    // confirmed account and the booking is minted owned.
    const known = await seedQuote(` ${GUEST_EMAIL} `);
    const knownBooking = await convert(known);
    expect(
      await ownerOf(knownBooking.id),
      'conversion stopped matching a padded address — the two matchers have to agree, and this is ' +
        'the side that already did',
    ).toBe(GUEST);

    // Half 2: and so must the claim. Same padded shape, but nobody holds the address yet, so the
    // booking is minted ownerless and the only route back to it is api_claim_quote_bookings.
    const padded = '  Padded.Paste@example.com ';
    const quote = await seedQuote(padded);
    const booking = await convert(quote);
    expect(await ownerOf(booking.id)).toBeNull();
    await db.asOwner();
    const { rows: stored } = await db.pg.query<{ customer_email: string }>(
      `select customer_email from bookings where id = $1`,
      [booking.id],
    );
    expect(
      stored[0]!.customer_email,
      'the booking no longer stores the quoted address verbatim, so this case is no longer testing ' +
        'the asymmetry it was written for',
    ).toBe(padded);

    const pasted = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await db.pg.query(
      `insert into auth.users (id, email, email_confirmed_at)
       values ($1, 'padded.paste@example.com', now())`,
      [pasted],
    );
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [pasted]);

    await db.as({ sub: pasted, role: 'authenticated' });
    const result = await rpc<{ claimed: number }>('api_claim_quote_bookings', {});
    await db.asOwner();

    expect(
      result.claimed,
      'the address the guest paid with is unclaimable: conversion trimmed it and the claim did not',
    ).toBe(1);
    expect(await ownerOf(booking.id)).toBe(pasted);
    expect(await visibleTo(pasted, booking.id)).toBe(true);
  });

  it('never moves a booking from one user to another', async () => {
    // The single most dangerous shape here. A booking that already has an owner is settled; a claim may
    // only ever fill a NULL. Otherwise a quote whose address was later re-registered — or simply
    // mistyped onto a real account — would silently transfer someone else's paid booking away.
    const quote = await seedQuote(STRANGER_EMAIL);
    const booking = await convert(quote);
    expect(await ownerOf(booking.id)).toBe(STRANGER);

    // Point the booking's own `customer_email` — the column the claim matches on — at a DIFFERENT
    // confirmed account. That is the address later re-registered, or simply mistyped, and it is the
    // one input a claim would otherwise act on. THIEF's own address, so nothing else in this file
    // shares it and the count below means exactly this booking.
    await db.asOwner();
    await db.pg.query(`update bookings set customer_email = $2 where id = $1`, [
      booking.id,
      THIEF_EMAIL,
    ]);

    await db.as({ sub: THIEF, role: 'authenticated' });
    const result = await rpc<{ claimed: number }>('api_claim_quote_bookings', {});
    await db.asOwner();

    expect(result.claimed).toBe(0);
    expect(await ownerOf(booking.id), "a claim stole another account's booking").toBe(STRANGER);
    expect(await visibleTo(THIEF, booking.id)).toBe(false);
  });

  it('claims nothing for a caller whose own address is UNCONFIRMED', async () => {
    const quote = await seedQuote('unconfirmed.claimer@example.com');
    const booking = await convert(quote);

    const pending = '88888888-8888-8888-8888-888888888888';
    await db.asOwner();
    await db.pg.query(
      `insert into auth.users (id, email, email_confirmed_at)
       values ($1, 'unconfirmed.claimer@example.com', null)`,
      [pending],
    );
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [pending]);

    await db.as({ sub: pending, role: 'authenticated' });
    const result = await rpc<{ claimed: number }>('api_claim_quote_bookings', {});
    await db.asOwner();

    expect(result.claimed).toBe(0);
    expect(await ownerOf(booking.id)).toBeNull();
  });

  it('matches the CALLER’S own address, never one supplied in the payload', async () => {
    // The claim takes no email argument, and a caller who invents one must get nothing. This is the
    // same class of hole api_erase_user closed by forcing v_email to the caller's own JWT identity:
    // a signed-in account passing a stranger's address would otherwise sweep the stranger's records.
    const quote = await seedQuote('typed.address@example.com');
    const booking = await convert(quote);

    await db.as({ sub: STRANGER, role: 'authenticated' });
    const result = await rpc<{ claimed: number }>('api_claim_quote_bookings', {
      email: 'typed.address@example.com',
      userId: STRANGER,
    });
    await db.asOwner();

    expect(result.claimed).toBe(0);
    expect(await ownerOf(booking.id), 'a typed address claimed a booking').toBeNull();
  });

  it('is not callable by anon, and refuses a caller with no session', async () => {
    // `revoke ... from public` alone does not strip Supabase's stock direct grants to anon/authenticated
    // — the one-word omission that has shipped a live hole from this repo three times.
    await db.as(null);
    await expect(rpc('api_claim_quote_bookings', {})).rejects.toThrow(/permission denied/);

    // service_role holds the grant (it is a normal server-callable RPC), but auth.uid() is null for it,
    // and a claim with no identity must refuse rather than match on nothing.
    await db.as({ role: 'service_role' });
    await expect(rpc('api_claim_quote_bookings', {})).rejects.toThrow(/unauthorized/);
    await db.asOwner();
  });

  // ── 3. The guest who never signs up still reaches their record ────────────────────────────────

  it('serves the paid receipt to a signed-out guest holding the link token, and 404s without it', async () => {
    // The reachability half of the task. This guest has no account and never will, so `requireUser` is
    // not an option — authorization is the SAME link token that authorised the payment, in the httpOnly
    // cookie scoped to /api/v1/quotes/{ref}. Every refusal is the same 404, so the route is not an
    // oracle for which quote refs exist.
    const quote = await seedQuote('no.account.ever@example.com');
    const booking = await convert(quote);
    await markPaid(booking.id);

    const ok = await RECEIPT(receiptRequest(quote.ref, quote.token), {
      params: Promise.resolve({ ref: quote.ref }),
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(1000);

    const wrongToken = await RECEIPT(receiptRequest(quote.ref, mintQuoteToken()), {
      params: Promise.resolve({ ref: quote.ref }),
    });
    expect(wrongToken.status).toBe(404);

    const noToken = await RECEIPT(receiptRequest(quote.ref, null), {
      params: Promise.resolve({ ref: quote.ref }),
    });
    expect(noToken.status).toBe(404);
  });

  it('will not hand out a receipt before the money has arrived', async () => {
    // A valid token on an unpaid quote is not a refusal to authenticate — it is a document that does
    // not exist yet. 409, with words, rather than a PDF claiming a payment nobody made.
    const quote = await seedQuote('not.paid.yet@example.com');
    await convert(quote);

    const res = await RECEIPT(receiptRequest(quote.ref, quote.token), {
      params: Promise.resolve({ ref: quote.ref }),
    });
    expect(res.status).toBe(409);
  });

  // ── 4. Erasure still reaches these bookings ───────────────────────────────────────────────────

  it('erases an OWNERLESS quote booking — the email branch is what reaches it', async () => {
    // api_erase_user matches `user_id = v_uid OR lower(customer_email) = v_email`. A quote booking may
    // have neither an owner nor a profile, so the email branch is the only one that can reach it, and
    // a staff erase is the only caller that supplies a pure-guest address. Confirmed, not assumed.
    const paidQuote = await seedQuote('erase.me@example.com', 22_000);
    const paid = await convert(paidQuote);
    await markPaid(paid.id);

    const unpaidQuote = await seedQuote('erase.me@example.com', 9_000);
    const unpaid = await convert(unpaidQuote);

    expect(await ownerOf(paid.id)).toBeNull();
    expect(await ownerOf(unpaid.id)).toBeNull();

    await db.as({ sub: STAFF, role: 'authenticated' });
    await rpc('api_erase_user', { email: 'erase.me@example.com' });
    await db.asOwner();

    // Paid: retained (it is a financial record) but stripped of the guest.
    const { rows: kept } = await db.pg.query<{ customer_name: string; customer_email: string }>(
      `select customer_name, customer_email from bookings where id = $1`,
      [paid.id],
    );
    expect(kept[0]!.customer_name).toBe('(Deleted user)');
    expect(kept[0]!.customer_email).toBe('deleted@privacy.invalid');

    // Unpaid: no retention duty, so the row goes outright — along with its custom lines.
    const { rows: gone } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from bookings where id = $1`,
      [unpaid.id],
    );
    expect(gone[0]!.n).toBe(0);
    const { rows: lines } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from booking_custom_items where booking_id = $1`,
      [unpaid.id],
    );
    expect(lines[0]!.n).toBe(0);
  });
});

/** The guest's request: a GET carrying the link cookie the browser attaches, and nothing else. */
function receiptRequest(ref: string, token: string | null): Request {
  const headers = new Headers();
  if (token !== null) headers.set('cookie', `${QUOTE_TOKEN_COOKIE}=${token}`);
  return new Request(`https://x/api/v1/quotes/${ref}/receipt`, { headers });
}
