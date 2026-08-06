import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { serviceRoleRpcContext } from '@/lib/http/context';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import {
  ConfigError,
  ConflictError,
  NotFoundError,
  QuoteAlreadyConvertedError,
} from '@/lib/services/errors';
import { callRpc } from '@/lib/services/rpc';
import { createPaymentLink } from '@/lib/services/payments';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import {
  quotePayReturnUrl,
  quoteRefLooksValid,
  readQuoteTokenCookie,
} from '@/lib/quotes/link-cookie';
import { resolveQuoteForToken } from '@/lib/quotes/resolve';
import { lineSubtotalMinor } from '@/lib/quotes/totals';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/quotes/:ref/pay — "Accept & pay" on the public quote page.
 *
 * AUTHENTICATED BY THE LINK TOKEN, not by `requireUser`. That is the point of the module: the guest
 * has no account, so there is no session to check. The token is not in the body either — it lives in
 * the httpOnly cookie GET /api/v1/quotes/{ref}/open set, scoped to `/api/v1/quotes/{ref}` (see
 * src/lib/quotes/link-cookie.ts), so the browser attaches the credential and no script on the page —
 * ours, GTM's or an injected one — ever holds it. SameSite=Lax is what makes a cookie-authenticated
 * POST safe from a cross-site form: a cross-site POST simply arrives without it, and lands on the 404
 * below. Per-IP rate limited like every other unauthenticated endpoint.
 *
 * ONE ANSWER FOR EVERY REFUSAL TO OPEN THE QUOTE: 404. `quotes.ref` is the path segment of a link that
 * gets forwarded, quoted in replies and pasted into chats; a 401-for-wrong-token / 404-for-unknown-ref
 * split would turn this endpoint into an oracle for which refs exist. {@link resolveQuoteForToken}
 * already collapses unknown ref, wrong token, unsent draft, withdrawn offer, lapsed validity and
 * "a total with no lines behind it" into a single null, and this route keeps that shape. It is also
 * what `startQuotePayment` turns into "This quote link has timed out. Please open the link in your
 * quote email again." — the likeliest cause by far, since the cookie lives two hours.
 *
 * ORDER OF OPERATIONS, and each step's reason:
 *
 *   1. rate limit, then the token — nothing is read for a caller who has not proved they hold a link;
 *   2. re-price the catalogue lines (below) — refuse BEFORE anything is minted;
 *   3. reuse the quote's existing payable booking, or convert with api_convert_quote, which takes the
 *      capacity hold for every catalogue line as it mints the booking;
 *   4. mint the checkout through `createPaymentLink`.
 *
 * THE SEAT IS RESERVED INSIDE STEP 3, NOT AFTER IT. The plan gave the order as "… api_convert_quote →
 * for each catalogue line take the hold and insert the booking_items row → mint the checkout", i.e.
 * with the hold taken from here. It is not: a hold taken from this route is a SECOND transaction, so a
 * departure that sold out in between would leave a converted quote and a payable booking with no seat
 * behind it — a guest paying for a place nobody reserved, which is the exact state the module refused
 * to convert at all rather than risk. api_convert_quote does it under the occurrence's own lock, in
 * the transaction that mints the booking, so a refusal takes the booking and `converted_at` back with
 * it and this route simply answers 409. A sold-out departure therefore reaches the guest as a
 * `sold_out` refusal here, before any checkout exists to charge.
 *
 * STEP 4 IS `createPaymentLink`, NEVER `createCheckout` in src/lib/payments/peach.ts. That service
 * goes through the create-payment RPC, which holds the single-flight checkout lease and pins the
 * charge: the lease is the thing that stops one booking having two payable Peach sessions (the defect
 * class fixed in ec5ebcf), and it also makes a second click on this route REUSE the live session
 * instead of opening another. Calling the provider directly would re-implement the invariant instead
 * of keeping it.
 *
 * WHY STEP 4 PASSES `authorizedBy: 'quote'`. api_create_payment ends its guard with
 *   `if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid()))`
 * which is right for a customer checkout — the public booking ref is not a bearer credential — and
 * impossible here: a quote booking has NO user_id (the guest has no account) and this route calls as
 * service_role, so auth.uid() is null and every quote payment was refused with 403 until
 * 20260911000000. That guard is untouched. The flag routes to api_create_quote_payment instead, which
 * SHARES api_create_payment's body — the same lease, the same reuse window, the same FX pin, so the
 * two can never drift into two payable sessions — and skips only the identity check, because
 * authorization here is the LINK TOKEN `resolveQuoteForToken` verified above, and the RPC is granted
 * to service_role alone so nothing reachable from a browser can call it without one.
 */

/* ---------------------------------------------------------------------------------------------
 * The typed client does not know these tables — same structural cast, and the same reason, as
 * src/lib/quotes/resolve.ts: the quotes module landed in 20260909000000 and is not in the generated
 * src/lib/supabase/types.ts. Kept narrow so a typo in one of these calls is still a compile error.
 * ------------------------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

interface Builder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): Builder;
  in(column: string, values: string[]): Builder;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
}

interface PayReadClient {
  from(table: 'quotes' | 'quote_items' | 'bookings' | 'activity_option_prices'): {
    select(columns: string): Builder;
  };
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  return String(value ?? '');
}

/** `bigint` columns: PostgREST hands back a JSON number, a wire driver a string or a BigInt. */
function minor(value: unknown): number {
  return Number(value ?? 0);
}

/**
 * The offer's internal id, its stored total, and the booking it has already minted — if that booking
 * can still take the guest's money.
 *
 * A second read of a row `resolveQuoteForToken` has just seen, on purpose: the model that function
 * returns is the GUEST-FACING one and deliberately carries no ids (its header explains why —
 * everything on it is serialised into a page the recipient of a forwarded link can read). This runs
 * only after the token has been verified, so it is not reachable without the link.
 */
interface QuoteConversion {
  id: string;
  totalMinor: number;
  /** Set only when the linked booking exists and is still payable — the reuse path. */
  payableBookingRef: string | null;
  /** The linked booking's ref whatever its state, so a refusal can name it. */
  bookingRef: string | null;
}

async function readConversion(db: PayReadClient, ref: string): Promise<QuoteConversion | null> {
  const { data, error } = await db
    .from('quotes')
    .select('id, total_minor, booking_id')
    .eq('ref', ref)
    .maybeSingle();
  if (error || !data) return null;

  const bookingId = data.booking_id == null ? null : text(data.booking_id);
  let bookingRef: string | null = null;
  let payableBookingRef: string | null = null;
  if (bookingId) {
    const booking = await db
      .from('bookings')
      .select('ref, status')
      .eq('id', bookingId)
      .maybeSingle();
    if (booking.data) {
      bookingRef = text(booking.data.ref);
      // `payment_pending` is the only state api_convert_quote mints and the only one
      // api_create_payment will still take money for. Anything else (paid, expired, cancelled) goes
      // down the convert path instead, where the RPC decides between re-arming a dead booking and
      // refusing — that judgement is its own, made under `for update` with the payments rows locked,
      // and must not be second-guessed from here.
      if (text(booking.data.status) === 'payment_pending') payableBookingRef = bookingRef;
    }
  }

  return {
    id: text(data.id),
    totalMinor: minor(data.total_minor),
    payableBookingRef,
    bookingRef,
  };
}

/**
 * One message for every re-pricing refusal. It says what happened and what to do, and it deliberately
 * quotes no figures: the guest is looking at the old ones.
 */
const PRICE_MOVED =
  'The prices on this quote have changed since it was sent, so we cannot take payment for it — ' +
  'please message us for an updated quote.';

/**
 * THE CATALOGUE RE-PRICE GATE — the gap the plan's own self-review named.
 *
 * A catalogue line is priced when the operator adds it to the draft, and the catalogue can move
 * before the guest clicks Pay: an option's price is edited, a tier is renamed, an option is retired.
 * `quotes.total_minor` is what api_convert_quote copies into `bookings.total_minor`, which is what
 * api_create_payment charges — so a moved price leaves exactly two bad outcomes, and this function
 * exists to take neither:
 *
 *   - charge the quoted total anyway → the guest pays a figure the catalogue no longer supports, and
 *     the VAT invoice's lines no longer reconcile with the operator's own price list;
 *   - re-price silently → the guest is charged a figure they never saw, which is worse.
 *
 * So it REFUSES, with a 409 the page can show, and it refuses BEFORE api_convert_quote runs: nothing
 * is minted, `converted_at` is not stamped, and the operator can re-send a corrected offer against the
 * same guest. Fail-closed in every direction — a catalogue line whose price row has gone (renamed
 * tier, deleted option) cannot be proven to still stand, so it refuses too.
 *
 * Only the CATALOGUE lines are re-derived. A custom line is the negotiated figure — it has no
 * catalogue entry to disagree with — and api_convert_quote already refuses (`quote_total_mismatch`)
 * if the stored total and the sum of the stored lines have drifted apart at all.
 *
 * `unit x quantity` is the whole of the arithmetic because it is the whole of the quote model:
 * `quoteItemRows` (src/lib/admin/quotes.ts) writes every line's `subtotal_minor` as exactly that,
 * through the same `lineSubtotalMinor` used here, so a recomputation that agrees with the catalogue
 * agrees with the stored line as well.
 */
async function assertQuotedPricesStillStand(
  db: PayReadClient,
  quoteId: string,
  totalMinor: number,
): Promise<void> {
  const { data, error } = await db
    .from('quote_items')
    .select('kind, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor')
    .eq('quote_id', quoteId);
  // A read that failed is not a quote that prices cleanly. Refuse rather than charge on a guess.
  if (error) throw new ConflictError(PRICE_MOVED);
  const lines = data ?? [];

  const catalogue = lines.filter((line) => text(line.kind) === 'catalogue');
  // Nothing to re-derive: every line is a negotiated figure, and the total-vs-lines check inside
  // api_convert_quote is the guard that covers those.
  if (catalogue.length === 0) return;

  const optionIds = [...new Set(catalogue.map((line) => text(line.activity_option_id)))];
  const prices = await db
    .from('activity_option_prices')
    .select('activity_option_id, label, amount_minor')
    .in('activity_option_id', optionIds);
  if (prices.error) throw new ConflictError(PRICE_MOVED);

  // Keyed on option + label joined by a NUL, which is the one byte a Postgres `text` value
  // cannot hold — a price label is operator-typed free text, so an ordinary separator could let two
  // different tiers collide into one key and silently pass the comparison below.
  const current = new Map<string, number>();
  for (const row of prices.data ?? []) {
    current.set(`${text(row.activity_option_id)}\u0000${text(row.label)}`, minor(row.amount_minor));
  }

  let recomputed = 0;
  for (const line of lines) {
    const quantity = Number(line.quantity ?? 0);
    if (text(line.kind) !== 'catalogue') {
      recomputed += minor(line.subtotal_minor);
      continue;
    }
    const unit = current.get(`${text(line.activity_option_id)}\u0000${text(line.price_label)}`);
    // No current price for this tier at all — renamed, retired, or the option was deleted. There is
    // nothing to compare the quoted figure against, so nothing proves it still stands.
    if (unit === undefined) throw new ConflictError(PRICE_MOVED);
    recomputed += lineSubtotalMinor({ quantity, unitAmountMinor: unit });
  }

  if (recomputed !== totalMinor) throw new ConflictError(PRICE_MOVED);
}

export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'quote_pay', 20, 60);
  const { ref } = await params;

  // Not a ref we could have minted, so there is nothing to open. Same answer as every other refusal.
  if (!quoteRefLooksValid(ref)) throw new NotFoundError('Not found');
  const token = readQuoteTokenCookie(req);
  if (!token) throw new NotFoundError('Not found');

  // THE authorization. Null for every refusal — see the header.
  const quote = await resolveQuoteForToken(ref, token);
  if (!quote) throw new NotFoundError('Not found');

  const env = getServerEnv();
  // FAIL CLOSED (money path), exactly as /api/v1/payments does: NEXT_PUBLIC_SITE_URL defaults to
  // localhost, and it builds BOTH the return URL and — via `originOf` in peach.ts — the Origin header
  // Peach is sent. A deploy that forgot to set it would send the guest to localhost after paying.
  if (!isSiteUrlConfiguredForLive(env)) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime. It builds the Peach return URL + Origin; refusing to create a ' +
        'checkout that would redirect the guest to localhost.',
      { code: 'site_url_not_configured' },
    );
  }

  const db = createServiceRoleClient() as unknown as PayReadClient;
  const conversion = await readConversion(db, ref);
  if (!conversion) throw new NotFoundError('Not found');

  // Both ports are the service role, unlike /api/v1/payments where the first is the signed-in caller:
  // there is no caller identity here by design, and api_convert_quote is granted to service_role only.
  const ctx = serviceRoleRpcContext();

  let bookingRef = conversion.payableBookingRef;
  if (!bookingRef) {
    await assertQuotedPricesStillStand(db, conversion.id, conversion.totalMinor);
    try {
      const booking = await callRpc<{ ref?: string } | null>(ctx, 'api_convert_quote', {
        quoteId: conversion.id,
      });
      bookingRef = text(booking?.ref);
    } catch (error) {
      if (!(error instanceof QuoteAlreadyConvertedError)) throw error;
      // Two tabs raced and the other one won between our read and this call. Its booking is payable,
      // so this is a reuse, not a refusal — re-read and carry on, which is what keeps "the same
      // checkout id twice" true even under the race. If it is NOT payable (already paid, or a dead
      // booking the RPC declined to re-arm) the refusal stands, now naming the booking so the page can
      // point the guest at it instead of describing it.
      const again = await readConversion(db, ref);
      if (!again?.payableBookingRef) {
        throw new QuoteAlreadyConvertedError(
          error.message,
          again?.bookingRef ? { bookingRef: again.bookingRef } : undefined,
        );
      }
      bookingRef = again.payableBookingRef;
    }
  }
  if (!bookingRef)
    throw new ConflictError('This quote is not ready to pay yet — please message us.');

  const link = await createPaymentLink(
    ctx,
    {
      bookingRef,
      // The QUOTE page, never `${SITE_URL}/bookings/{ref}`: this becomes Peach's shopperResultUrl,
      // where a card taking the redirect-based 3-D Secure path returns the guest top-level, and a
      // quote guest has no account to sign in to. See quotePayReturnUrl's own header.
      returnUrl: quotePayReturnUrl(ref),
      // The quote entry point (api_create_quote_payment), because there is no caller identity to check
      // here — see step 4 in the header.
      authorizedBy: 'quote',
    },
    ctx,
  );

  // `bookingRef` alongside the link: the page needs it to hand the guest to /bookings/{ref}/pay with
  // the session id, and to stash the pinned MUR figure for the charge notice.
  return jsonOk({ ...link, bookingRef }, { status: 201 });
});
