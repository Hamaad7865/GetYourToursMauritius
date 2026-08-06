import { z } from 'zod';
import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { serviceRoleRpcContext } from '@/lib/http/context';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { createPaymentLink } from '@/lib/services/payments';
import { quotePayReturnUrl } from '@/lib/quotes/link-cookie';
import { ConfigError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/services/errors';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/admin/quotes/:ref/balance — the operator's "Send balance link" button
 * (src/lib/admin/quotes.ts `sendBalanceLink`).
 *
 * A quote guest pays a DEPOSIT (Task 2 of the quote-deposit plan) which confirms the booking and
 * reserves the seat; the BALANCE is chased later, by hand, with a second payment link. This route
 * mints that balance checkout and hands the operator the public payment URL to copy to the guest
 * (over WhatsApp or their own email). It is the balance's analogue of admin/quotes/send/route.ts, and
 * it borrows that route's STAFF GATE verbatim.
 *
 * ── THE STAFF GATE (copied from the send route, and for the same reasons) ─────────────────────────
 * `requireUser(req).role` is the JWT's POSTGRES role selector — 'authenticated' for staff and customer
 * alike — and NEVER the app's business role. There is no shared `requireStaff` helper, so the check is
 * the one the send route makes: look `profiles.role` up through the service-role client (RLS-exempt, so
 * it can answer for any caller). 'seo' IS NOT ADMITTED, exactly as on the send route: a quote carries
 * the guest's name, their email, and the operator's own margin note on the same row.
 *
 * ── WHY IT MINTS RATHER THAN ROTATES A TOKEN ──────────────────────────────────────────────────────
 * The send route's job is to write `quotes.token_hash`; this route MUST NOT. Rotating it would kill the
 * link the guest is still holding (the one their deposit came in on, and the one their receipt/booking
 * page is reachable through). The balance is not a new offer — it is a second charge on a booking that
 * already exists — so there is nothing to re-mint a token for. The public URL is the balance CHECKOUT's
 * own payment URL, minted by `createPaymentLink({ purpose: 'balance', authorizedBy: 'quote' })`:
 *
 *   * `purpose: 'balance'` because the deposit already CONFIRMED the booking, so a second 'booking' row
 *     would trip create_payment's booking-payability guard (booking_not_payable). The balance is a
 *     separate purpose with its own payability branch — allowed on a confirmed booking that still owes
 *     something — exactly as the late-pickup add-on is (20260912000000, Task 4). Its amount is the
 *     booking's own `balance_due_minor`, read server-side, never from a caller.
 *   * `authorizedBy: 'quote'` because a quote booking has NO user_id — the guest has no account — so
 *     api_create_payment's identity check would refuse it. The quote entry point
 *     (api_create_quote_payment) skips that check and is service-role-only; both entry points share the
 *     one create_payment body, so they take the SAME single-flight checkout lease and one balance can
 *     never fork into two payable sessions. `serviceRoleRpcContext()` is passed as BOTH ports, like the
 *     quote pay route: there is no caller identity here by design.
 *
 * ── WHAT IT REFUSES BEFORE MINTING ANYTHING ──────────────────────────────────────────────────────
 * Each refusal is a readable 409/404 the operator can act on, taken from the booking's own state so it
 * never opens a checkout that create_payment would only reject:
 *
 *   1. No such quote → 404.
 *   2. A quote with no booking yet → the guest has not paid the deposit, so there is no booking to
 *      collect a balance on. 409.
 *   3. A booking that is not `confirmed` → the deposit has not settled (or the booking died), so there
 *      is no balance to send yet. 409. (create_payment's balance branch enforces the same, in SQL.)
 *   4. `balance_due_minor <= 0` → the booking is fully paid (a pay-in-full quote, or a balance already
 *      collected). There is nothing to charge, so no balance row is opened. 409. This is the readable
 *      form of create_payment's own `balance_already_paid`, taken here so the operator gets a 409
 *      instead of an unmapped 500.
 *
 * The reads are the service-role client's, like the send route; the typed client does not know the
 * quotes tables (they are not in the generated types), so the same narrow structural cast is used.
 */

// The ref is the path segment; nothing else is caller-supplied. A body is still parsed so a malformed
// one is a clean 400, and the client posts `{}`.
const bodySchema = z.object({});

/** The business roles allowed to send a guest a payment link. See the staff-gate note above re 'seo'. */
const SENDING_ROLES = new Set(['admin', 'staff']);

/* ---------------------------------------------------------------------------------------------
 * The typed client does not know the quotes tables — the same structural cast, and the same reason, as
 * app/api/v1/admin/quotes/send/route.ts and src/lib/quotes/resolve.ts: the quotes module landed in
 * 20260909000000 and is not in the generated src/lib/supabase/types.ts. Kept narrow so a typo in one
 * of these calls is still a compile error.
 * ------------------------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

interface ReadBuilder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): ReadBuilder;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
}

interface BalanceClient {
  from(table: 'quotes' | 'bookings' | 'profiles'): {
    select(columns: string): ReadBuilder;
  };
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  return String(value ?? '');
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

/** `bigint` columns: PostgREST hands back a JSON number, other drivers a string or a BigInt. */
function minor(value: unknown): number {
  return Number(value ?? 0);
}

/**
 * The signed-in caller's business role, or null when they have no profile row. Read through the
 * SERVICE-ROLE client on purpose: `profiles` is RLS-protected and this must answer for any caller.
 */
async function callerRole(db: BalanceClient, userId: string): Promise<string | null> {
  const { data, error } = await db.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error)
    throw new Error(String((error as { message?: string }).message ?? 'profile read failed'));
  return textOrNull(data?.role ?? null);
}

export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  // Before the auth check, as on every other rate-limited route here. The budget protected is the
  // payment provider's checkout-create endpoint.
  await rateLimit(req, 'admin_quote_balance', 20, 60);

  const user = await requireUser(req);
  const db = createServiceRoleClient() as unknown as BalanceClient;
  const role = await callerRole(db, user.id);
  if (!role || !SENDING_ROLES.has(role)) {
    throw new ForbiddenError('Staff only');
  }

  await parseJsonBody(req, bodySchema);

  const { ref } = await params;

  // FAIL CLOSED on the site URL, like the quote pay route: createPaymentLink builds BOTH the Peach
  // return URL and — via `originOf` in peach.ts — the Origin header Peach is sent, from
  // NEXT_PUBLIC_SITE_URL. A deploy that forgot it would mint a checkout that redirects the guest to
  // localhost. Checked BEFORE anything is minted.
  if (!isSiteUrlConfiguredForLive(getServerEnv())) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime. It builds the balance checkout’s return URL + Origin; refusing to ' +
        'create a checkout that would redirect the guest to localhost.',
      { code: 'site_url_not_configured' },
    );
  }

  // The quote, and the booking its deposit already minted. `internal_notes` and `token_hash` are
  // deliberately NOT selected: neither is needed to mint the balance link, and what is never loaded
  // cannot be surfaced by mistake.
  const { data: quote, error } = await db
    .from('quotes')
    .select('booking_id')
    .eq('ref', ref)
    .maybeSingle();
  if (error)
    throw new Error(String((error as { message?: string }).message ?? 'quote read failed'));
  if (!quote) throw new NotFoundError('Not found');

  const bookingId = textOrNull(quote.booking_id);
  if (!bookingId) {
    throw new ConflictError(
      `Quote ${ref} has not been paid yet — there is no booking to collect a balance on. The balance ` +
        `link can only be sent once the guest has paid the deposit.`,
    );
  }

  const { data: booking, error: bookingError } = await db
    .from('bookings')
    .select('ref, status, balance_due_minor')
    .eq('id', bookingId)
    .maybeSingle();
  if (bookingError)
    throw new Error(
      String((bookingError as { message?: string }).message ?? 'booking read failed'),
    );
  // The booking is gone — an erasure hard-deletes an unpaid quote booking and the FK nulls the pointer,
  // but a converted_at that pointed at a live one is what we just read. Treat a missing row as "nothing
  // to collect", not a 500.
  if (!booking) {
    throw new ConflictError(
      `Quote ${ref} has no live booking behind it, so there is no balance to collect.`,
    );
  }

  const bookingRef = text(booking.ref);
  const status = text(booking.status);
  const balanceDueMinor = minor(booking.balance_due_minor);

  if (status !== 'confirmed') {
    throw new ConflictError(
      `Quote ${ref}’s booking ${bookingRef} is ${status}, not confirmed — its deposit has not settled, ` +
        `so there is no balance to send yet.`,
    );
  }
  if (balanceDueMinor <= 0) {
    throw new ConflictError(
      `Quote ${ref} is fully paid — nothing is owed, so there is no balance to collect.`,
    );
  }

  // Both ports are the service role, like the quote pay route: there is no caller identity here by
  // design, and api_create_quote_payment / api_record_payment_checkout are granted to service_role only.
  const ctx = serviceRoleRpcContext();
  const link = await createPaymentLink(
    ctx,
    {
      bookingRef,
      // The QUOTE page, like the pay route: a card taking the redirect-based 3-D Secure path returns
      // the guest top-level to this URL, and a quote guest has no account to sign in to.
      returnUrl: quotePayReturnUrl(ref),
      purpose: 'balance',
      authorizedBy: 'quote',
    },
    ctx,
  );

  // The public payment URL for the operator's copy button. It is present on a freshly-minted checkout;
  // it is absent only when createPaymentLink REUSED a still-live session (a balance link minted for
  // this booking in the last few minutes), in which case the operator already has the URL from that
  // click. Refuse rather than hand back an empty string to copy.
  if (!link.redirectUrl) {
    throw new ConflictError(
      `A balance payment link for quote ${ref} was generated moments ago and is still live — use the ` +
        `link you already copied, or try again shortly.`,
    );
  }

  return jsonOk({ url: link.redirectUrl });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
