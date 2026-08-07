import { z } from 'zod';
import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { hashQuoteToken, mintQuoteToken } from '@/lib/quotes/token';
import { getNotificationProvider } from '@/lib/notifications';
import { renderQuoteBalanceEmail } from '@/lib/email/quote';
import { quoteBalancePagePath } from '@/lib/quotes/link-cookie';
import { SITE } from '@/lib/seo/site';
import { ConfigError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/services/errors';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/admin/quotes/:ref/balance — the operator's "Send balance link" button
 * (src/lib/admin/quotes.ts `sendBalanceLink`).
 *
 * A quote guest pays a DEPOSIT (Task 2 of the quote-deposit plan) which confirms the booking and
 * reserves the seat; the BALANCE is chased later, by hand, with a second payment link. This route mints
 * a DURABLE balance link and hands the operator the public URL to copy to the guest (over WhatsApp or
 * their own email).
 *
 * ── WHY DURABLE, AND WHY THIS ROUTE NO LONGER MINTS A CHECKOUT ────────────────────────────────────
 * It used to mint the balance CHECKOUT here, at send time, and return /bookings/{ref}/pay?cid=… . A
 * Peach checkout session expires in ~30 minutes, so that link died within the hour — and an accountless
 * quote guest has no account to re-mint from, so the balance became uncollectable until staff sent a
 * fresh link. The deposit link never had this problem: the public /quotes/{ref} page mints a FRESH
 * checkout on the guest's CLICK, days later if need be. The balance now works the same way.
 *
 * So this route mints a durable balance-link TOKEN (mintQuoteToken), stores only its SHA-256 in
 * `quotes.balance_token_hash`, and returns /quotes/{ref}/balance?t=<rawToken>. The guest's page resolves
 * that token (resolveBalanceForToken) and its Pay button mints the checkout on the click
 * (/api/v1/quotes/{ref}/balance/pay → api_create_quote_payment purpose='balance'). Nothing expires but
 * the balance itself: the URL keeps working for as long as `balance_due_minor > 0`.
 *
 * ── IT MUST NOT ROTATE `token_hash` ──────────────────────────────────────────────────────────────
 * `balance_token_hash` is a SEPARATE column from `token_hash` (the deposit/quote link's hash) precisely
 * so that minting a balance link never breaks the link the guest is still holding — the one their
 * deposit came in on, and the one their receipt/booking page is reachable through. This route writes
 * ONLY `balance_token_hash`.
 *
 * ── THE STAFF GATE (copied from the send route, and for the same reasons) ─────────────────────────
 * `requireUser(req).role` is the JWT's POSTGRES role selector — 'authenticated' for staff and customer
 * alike — and NEVER the app's business role. There is no shared `requireStaff` helper, so the check is
 * the one the send route makes: look `profiles.role` up through the service-role client (RLS-exempt, so
 * it can answer for any caller). 'seo' IS NOT ADMITTED, exactly as on the send route: a quote carries
 * the guest's name, their email, and the operator's own margin note on the same row.
 *
 * ── WHAT IT REFUSES BEFORE MINTING A TOKEN ───────────────────────────────────────────────────────
 * Each refusal is a readable 409/404 the operator can act on, taken from the booking's own state so it
 * never hands out a link the balance branch of create_payment would only reject:
 *
 *   1. No such quote → 404.
 *   2. A quote with no booking yet → the guest has not paid the deposit, so there is no booking to
 *      collect a balance on. 409.
 *   3. A booking that is not `confirmed` → the deposit has not settled (or the booking died), so there
 *      is no balance to send yet. 409.
 *   4. `balance_due_minor <= 0` → the booking is fully paid (a pay-in-full quote, or a balance already
 *      collected). There is nothing to charge, so no link is minted. 409.
 *
 * The reads and the write are the service-role client's, like the send route; the typed client does not
 * know the quotes tables (they are not in the generated types), so the same narrow structural cast is
 * used. `internal_notes` is deliberately never selected — what is never loaded cannot be surfaced by
 * mistake.
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

interface WriteBuilder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): WriteBuilder;
  select(columns: string): WriteBuilder;
}

interface BalanceClient {
  from(table: 'quotes' | 'bookings' | 'profiles'): {
    select(columns: string): ReadBuilder;
    update(payload: Row): WriteBuilder;
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
  // Before the auth check, as on every other rate-limited route here.
  await rateLimit(req, 'admin_quote_balance', 20, 60);

  const user = await requireUser(req);
  const db = createServiceRoleClient() as unknown as BalanceClient;
  const role = await callerRole(db, user.id);
  if (!role || !SENDING_ROLES.has(role)) {
    throw new ForbiddenError('Staff only');
  }

  await parseJsonBody(req, bodySchema);

  const { ref } = await params;

  // FAIL CLOSED on the site URL, like the send route: the link that goes to the guest is absolute
  // (`${SITE.url}/quotes/{ref}/balance?t=…`), and a deploy that forgot NEXT_PUBLIC_SITE_URL would hand
  // the operator a localhost link to copy. Checked BEFORE a token is minted.
  if (!isSiteUrlConfiguredForLive(getServerEnv())) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime. It builds the balance link the operator copies to the guest; ' +
        'refusing to hand out a localhost link.',
      { code: 'site_url_not_configured' },
    );
  }

  // The quote, and the booking its deposit already minted. `internal_notes` and the token hashes are
  // deliberately NOT selected: none is needed to mint the balance link, and what is never loaded cannot
  // be surfaced by mistake.
  const { data: quote, error } = await db
    .from('quotes')
    // The guest fields the email needs. `internal_notes` and the token hashes stay unselected: what
    // is never loaded cannot be surfaced by mistake. `locale` is a property of the OFFER — the same
    // language its quote, confirmation and VAT invoice were written in — not of the operator here.
    .select('id, booking_id, customer_name, customer_email, currency, locale')
    .eq('ref', ref)
    .maybeSingle();
  if (error)
    throw new Error(String((error as { message?: string }).message ?? 'quote read failed'));
  if (!quote) throw new NotFoundError('Not found');

  const quoteId = text(quote.id);
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
  // The booking is gone — an erasure hard-deletes an unpaid quote booking and the FK nulls the pointer.
  // Treat a missing row as "nothing to collect", not a 500.
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

  // Mint the durable balance-link token, store ONLY its hash, and NEVER touch `token_hash`. A re-send
  // (staff pressing the button again) rotates `balance_token_hash` and supersedes the previous balance
  // link — the same one-hash-per-column behaviour as the deposit link — but the guest's original quote
  // link is on a different column and keeps working. Storing the token (not the raw value) is what makes
  // a leaked database backup unable to mint a working link.
  const token = mintQuoteToken();
  const { data: updated, error: writeError } = await db
    .from('quotes')
    .update({
      balance_token_hash: await hashQuoteToken(token),
      updated_at: new Date().toISOString(),
    })
    .eq('id', quoteId)
    .select('id');
  if (writeError)
    throw new Error(String((writeError as { message?: string }).message ?? 'quote write failed'));
  if (!updated || updated.length === 0) {
    // The quote was erased between the read and the write. Nothing was minted.
    throw new ConflictError(
      `Quote ${ref} was removed while the balance link was being created, so no link was minted.`,
    );
  }

  // The durable public URL for the operator's copy button — the balance PAGE, carrying the raw token.
  // The page redirects that `?t=` through the balance open route (which moves the token into an
  // httpOnly cookie and 302s to the clean page) before it renders, so the token is never handed to GTM
  // or written to error_logs — the same protection the deposit link has. This is the raw token's only
  // home besides the guest's copy of the URL: it is never logged and never written to any other column.
  const url = `${SITE.url}${quoteBalancePagePath(ref)}?t=${encodeURIComponent(token)}`;

  /* AND SEND IT, exactly as the quote itself is sent. The operator's copy button is a fallback, not
   * the delivery mechanism — leaving it as the only one meant the balance was chased by hand, and a
   * link that lives only in a clipboard is a link that goes missing.
   *
   * IN-REQUEST, not on the `notifications` outbox, and for the reason the send route states: an
   * outbox row PERSISTS its payload, so queueing this would write a live bearer token into a table
   * the drain reads, retries and logs against. The token's only homes stay the guest's email and the
   * `url` returned here.
   *
   * The email is rendered from the RAW token (renderQuoteBalanceEmail builds the /api/ open-route
   * link itself, so no caller can email the page URL that would leak it into GTM or error_logs), and
   * the render happens AFTER the hash is stored — the link must be resolvable by the time it lands.
   *
   * A SEND FAILURE IS NOT A FAILED REQUEST. The token is already stored and `url` is already valid,
   * so answering 500 would tell the operator nothing was minted while a working link existed; they
   * would press the button again and rotate a link the guest may already hold. Instead the URL comes
   * back with `emailed: false` and the operator copies it by hand. */
  let emailed = false;
  try {
    const email = renderQuoteBalanceEmail({
      ref,
      customerName: text(quote.customer_name),
      currency: text(quote.currency),
      balanceDueMinor,
      locale: textOrNull(quote.locale),
      linkToken: token,
    });
    await getNotificationProvider().send({
      // A fresh id per send, never the quote's: the Resend provider keys its Idempotency-Key on it,
      // and re-sending a balance link is a DIFFERENT email carrying a different link.
      id: crypto.randomUUID(),
      channel: 'email',
      recipient: text(quote.customer_email),
      template: 'quote_balance',
      // From the monitored info@ inbox, like the quote — a guest should be able to just hit Reply.
      from: getServerEnv().QUOTE_FROM ?? SITE.email,
      // EMPTY, and it stays empty: a payload is the sort of thing that gets logged, and the token is
      // in the rendered body. The provider only falls back to rendering from it when no body is set.
      payload: {},
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    emailed = true;
  } catch {
    emailed = false;
  }

  return jsonOk({ url, emailed });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
