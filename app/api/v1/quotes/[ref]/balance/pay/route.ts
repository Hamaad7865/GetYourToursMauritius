import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { serviceRoleRpcContext } from '@/lib/http/context';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import { ConfigError, ConflictError, NotFoundError } from '@/lib/services/errors';
import { createPaymentLink } from '@/lib/services/payments';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import {
  quoteBalancePayReturnUrl,
  quoteRefLooksValid,
  readQuoteBalanceTokenCookie,
} from '@/lib/quotes/link-cookie';
import { resolveBalanceForToken } from '@/lib/quotes/resolve';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/quotes/:ref/balance/pay — "Pay balance" on the durable balance page.
 *
 * The balance's analogue of /api/v1/quotes/{ref}/pay, and simpler: there is nothing to convert (the
 * deposit already minted and confirmed the booking), so this only mints the balance checkout. It is
 * what makes the link DURABLE — a FRESH Peach session is minted on THIS click, not at the time staff
 * sent the link, so the URL keeps working for as long as the balance is owed.
 *
 * AUTHENTICATED BY THE BALANCE LINK TOKEN, not by `requireUser`: the guest has no account. The token
 * is not in the body either — it lives in the httpOnly cookie the balance open route set, scoped to
 * `/api/v1/quotes/{ref}/balance` (src/lib/quotes/link-cookie.ts), so the browser attaches the
 * credential and no script on the page ever holds it. `SameSite=Lax` makes a cookie-authenticated POST
 * safe from a cross-site form: a cross-site POST simply arrives without it and lands on the 404 below.
 *
 * ONE ANSWER FOR EVERY REFUSAL TO OPEN THE BALANCE: 404. {@link resolveBalanceForToken} collapses
 * unknown ref, wrong/absent token, no booking, a not-confirmed booking and a fully-paid one into a
 * single null, and this route keeps that shape so the endpoint is not an oracle for which quote refs
 * exist. It is also what the client turns into "This balance link has timed out. Please open the link
 * we sent you again."
 *
 * WHY IT PASSES `authorizedBy: 'quote'` and `purpose: 'balance'`. A quote booking has NO user_id, so
 * api_create_payment's identity check would refuse it; the quote entry point
 * (api_create_quote_payment) skips that check because authorization here is the LINK TOKEN this route
 * already verified, and it is granted to service_role alone. `purpose: 'balance'` because the deposit
 * already CONFIRMED the booking, so a second 'booking' row would trip create_payment's booking-
 * payability guard — the balance is a separate purpose with its own payability branch, allowed on a
 * confirmed booking that still owes something, its amount the booking's own `balance_due_minor`.
 *
 * Both entry points share the one create_payment body, so a deposit checkout and a balance checkout,
 * and TWO clicks of this button, all take the SAME single-flight lease: two opens of the durable link
 * reuse one live session rather than forking two payable ones. That reuse is exactly what "mints a
 * fresh checkout on each open" means in practice — a fresh mint when the previous session has died, the
 * same live session while it has not.
 */

/* ---------------------------------------------------------------------------------------------
 * The typed client does not know the quotes tables — same structural cast, and the same reason, as
 * src/lib/quotes/resolve.ts: the quotes module landed in 20260909000000 and is not in the generated
 * src/lib/supabase/types.ts. Kept narrow so a typo in one of these calls is still a compile error.
 * ------------------------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

interface Builder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): Builder;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
}

interface BalancePayClient {
  from(table: 'quotes' | 'bookings'): {
    select(columns: string): Builder;
  };
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  return String(value ?? '');
}

/**
 * The booking ref behind the quote, for a quote {@link resolveBalanceForToken} has already authorized
 * and proved payable. A second read of the same row on purpose: the balance model that function
 * returns is the GUEST-FACING one and carries no ids. This runs only after the token has been
 * verified, so it is not reachable without the link.
 */
async function readBookingRef(db: BalancePayClient, ref: string): Promise<string | null> {
  const { data, error } = await db.from('quotes').select('booking_id').eq('ref', ref).maybeSingle();
  if (error || !data) return null;
  const bookingId = data.booking_id == null ? null : text(data.booking_id);
  if (!bookingId) return null;
  const booking = await db.from('bookings').select('ref').eq('id', bookingId).maybeSingle();
  if (booking.error || !booking.data) return null;
  return text(booking.data.ref);
}

export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'quote_balance_pay', 20, 60);
  const { ref } = await params;

  // Not a ref we could have minted, so there is nothing to open. Same answer as every other refusal.
  if (!quoteRefLooksValid(ref)) throw new NotFoundError('Not found');
  const token = readQuoteBalanceTokenCookie(req);
  if (!token) throw new NotFoundError('Not found');

  // THE authorization AND the payability gate. Null for every refusal — see the header.
  const balance = await resolveBalanceForToken(ref, token);
  if (!balance) throw new NotFoundError('Not found');

  const env = getServerEnv();
  // FAIL CLOSED (money path), exactly as the deposit pay route: NEXT_PUBLIC_SITE_URL builds BOTH the
  // return URL and — via `originOf` in peach.ts — the Origin header Peach is sent. A deploy that
  // forgot it would send the guest to localhost after paying.
  if (!isSiteUrlConfiguredForLive(env)) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime. It builds the balance checkout’s return URL + Origin; refusing to ' +
        'create a checkout that would redirect the guest to localhost.',
      { code: 'site_url_not_configured' },
    );
  }

  const db = createServiceRoleClient() as unknown as BalancePayClient;
  const bookingRef = await readBookingRef(db, ref);
  // resolveBalanceForToken already proved the booking exists and is confirmed, so a missing ref here is
  // a transient fault, not a state — refuse rather than mint against nothing.
  if (!bookingRef)
    throw new ConflictError('This balance is not ready to pay right now — please message us.');

  // Both ports are the service role, like the deposit pay route: there is no caller identity here by
  // design, and api_create_quote_payment is granted to service_role only.
  const ctx = serviceRoleRpcContext();
  const link = await createPaymentLink(
    ctx,
    {
      bookingRef,
      // The BALANCE page, so a card taking the redirect-based 3-D Secure path returns the guest to
      // their own durable balance page, not the /bookings sign-in wall.
      returnUrl: quoteBalancePayReturnUrl(ref),
      purpose: 'balance',
      authorizedBy: 'quote',
    },
    ctx,
  );

  // `bookingRef` alongside the link: the page needs it to hand the guest to /bookings/{ref}/pay with
  // the session id, and to stash the pinned MUR figure for the charge notice.
  return jsonOk({ ...link, bookingRef }, { status: 201 });
});
