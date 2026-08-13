import { z } from 'zod';
import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { getNotificationProvider } from '@/lib/notifications';
import { renderQuoteEmail, type QuoteEmailLine } from '@/lib/email/quote';
import { DEFAULT_DEPOSIT_BPS } from '@/lib/quotes/deposit';
import { computeQuoteSchedule } from '@/lib/quotes/payment-schedule';
import { quoteOpenPath } from '@/lib/quotes/link-cookie';
import { hashQuoteToken, mintQuoteToken } from '@/lib/quotes/token';
import { assertQuoteStillValid } from '@/lib/quotes/validity';
import { SITE } from '@/lib/seo/site';
import {
  ConfigError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ProviderError,
  ValidationError,
} from '@/lib/services/errors';

export const runtime = 'edge';

/**
 * POST /api/v1/admin/quotes/send — the operator's Send button (src/lib/admin/quotes.ts `sendQuote`).
 *
 * THIS ROUTE IS THE ONLY WRITER OF `quotes.token_hash`, which makes it the only thing in the codebase
 * that can turn a draft into an offer a guest can open and pay for. Everything else about the module
 * — the editor, the public page, the pay route, api_convert_quote — is downstream of the row this
 * writes. It is server-side and not browser-side for two reasons that are not negotiable: the raw
 * link token must never round-trip through a client the operator could paste it out of, and the mail
 * credentials are server-only.
 *
 * ── THE STAFF GATE ────────────────────────────────────────────────────────────────────────────
 * `requireUser(req).role` is the JWT's POSTGRES role selector — 'anon' / 'authenticated' /
 * 'service_role' — and NEVER the app's business role. A gate written against it either admits every
 * signed-in customer (comparing to 'authenticated') or refuses everyone (comparing to 'admin'). There
 * is no shared `requireStaff` helper in this repo, so the check is the one the other two staff-gated
 * routes make: look `profiles.role` up directly through the service-role client
 * (app/api/v1/reviews/google-live/route.ts, app/api/v1/seo/search-console/route.ts).
 *
 * 'seo' IS NOT ADMITTED, unlike on the Search Console route where it is. That route hands back
 * aggregate search performance and no customer data; a quote carries the guest's name, their email
 * address, the price we offered them and the operator's own margin note on the same row — and sending
 * one emails a stranger on the company's behalf.
 *
 * ── WHAT IT REFUSES TO SEND, AND WHY EACH ONE ─────────────────────────────────────────────────
 * An email cannot be recalled, so every refusal below is cheaper than the state it prevents: an
 * operator sees an error toast and fixes the quote, instead of a guest reading a priced offer above a
 * link whose only possible answer is a refusal.
 *
 *   1. A status that cannot become a payment. api_convert_quote's whitelist is ('sent', 'accepted'),
 *      so a `cancelled` or `expired` quote is unchargeable — and resolveQuoteForToken refuses the
 *      public page outright for a withdrawn one, so the guest would not even see the offer. An
 *      ACCEPTED quote is refused for a different and sharper reason: see the re-send note below.
 *   2. Validity, via the existing `assertQuoteStillValid` — its docstring names this call site.
 *      saveQuote makes the same check at the keystroke; this is not a duplicate of it but the second
 *      of the two moments that matter, because a quote drafted on Friday and sent on Monday passed
 *      that one and is dead by the time the email goes out.
 *   3. No lines, a zero total, or a NEGATIVE one. `quotes.total_minor` defaults to 0 and carries no
 *      `>= 0` CHECK, so both ends are reachable by an empty draft or a hand-edited row;
 *      api_convert_quote reads either as `quote_not_convertible` ('zero total'), and a card cannot be
 *      charged a negative figure at all. `renderQuoteEmail` refuses <= 0 too, but it phrases its
 *      refusal in terms of the RPC's error names — these three say what the operator should do.
 *   4. A total that has drifted from its lines. That refusal is `renderQuoteEmail`'s and is left
 *      there: it is the same function that prints the figure, so the check cannot fall out of step
 *      with what the guest would read.
 *
 * A CATALOGUE LINE IS NO LONGER ONE OF THEM. It used to be: api_convert_quote refused any quote
 * carrying a scheduled activity while the hold path that reserves the seat was unbuilt, so emailing
 * one would have sent a priced offer whose Pay button could only say "message us". That path now
 * exists — the conversion takes the hold and writes the booking_items row in the transaction that
 * mints the booking — so a quote of real tours is exactly what this route is for. Availability is
 * NOT re-checked here on purpose: the answer would be stale by the time the guest reads the email,
 * and the only check that can be trusted is the one taken under the occurrence's own lock at the
 * moment of payment.
 *
 * ── RE-SEND ROTATES THE TOKEN. THE PREVIOUS LINK STOPS WORKING. ───────────────────────────────
 * `quotes.token_hash` holds ONE hash, so this is the only migration-free behaviour available — but it
 * is also the one to want. A quote is re-sent because something changed (a re-price, a corrected
 * date, a guest who never got the first email), and the newest email should be the live one; an old
 * link forwarded to a colleague must not keep opening an offer that has moved on.
 *
 * It is also why an ACCEPTED quote is refused above rather than re-sent. Rotating the hash makes the
 * link-token cookie the guest's browser is holding stop matching, so a guest sitting on the card form
 * would be dropped onto a 404 mid-payment — and the write would rewrite their `accepted` status back
 * to `sent`. Their booking is the record that matters by then; send them there, not here.
 *
 * ── THE RAW TOKEN ─────────────────────────────────────────────────────────────────────────────
 * Minted here, hashed into `quotes.token_hash`, and thereafter it exists in exactly two places: the
 * URL inside the guest's email, and the `url` field of this one response (the operator's copy button,
 * for a guest who asks for the link over WhatsApp). It is never logged, never put in the outbox, and
 * never written to any other column.
 *
 * THE EMAIL IS SENT IN-REQUEST, not enqueued on the `notifications` outbox like every other mail this
 * app sends, and that is a consequence of the line above rather than a shortcut: an outbox row stores
 * its payload — and, for a pre-rendered message, its HTML — in the database, so queueing this email
 * would persist a live bearer token in a table the drain reads, retries and logs against. The outbox
 * buys retries; this route buys the operator an immediate, honest answer instead, and Send can simply
 * be pressed again.
 *
 * ── ORDER OF WRITES ───────────────────────────────────────────────────────────────────────────
 * Nothing is written until the email has been fully RENDERED, because `renderQuoteEmail` is the last
 * refusal and it is pure. Then the row is written, and only then is the mail handed to the provider.
 * That order is deliberate: the guest's link works only if `token_hash` is stored and the status is
 * one api_convert_quote will convert, so sending first would email a link that cannot be opened. The
 * cost of this direction is a quote that reads `sent` after a provider outage with no email behind it
 * — visible, harmless (nobody holds that token), and fixed by pressing Send again, which mints a
 * fresh link and invalidates the stranded one.
 */

const bodySchema = z.object({
  // A uuid, not a bare string: `quotes.id` is one, and a non-uuid would otherwise reach Postgres and
  // come back as a raw 22P02 the operator cannot act on.
  quoteId: z.string().uuid(),
});

/** The business roles allowed to email an offer to a guest. See the staff-gate note above re 'seo'. */
const SENDING_ROLES = new Set(['admin', 'staff']);

/**
 * The statuses a quote may be SENT from.
 *
 * `draft` is the first send and `sent` is a re-send. Everything else is refused: 'cancelled' was
 * withdrawn, 'expired' is a terminal state api_convert_quote raises `quote_expired` for, and
 * 'accepted' means the guest already converted — see the re-send note in the header.
 */
const SENDABLE_STATUSES = new Set(['draft', 'sent']);

/* ---------------------------------------------------------------------------------------------
 * The typed client does not know these tables — the same structural cast, and the same reason, as
 * src/lib/quotes/resolve.ts and app/api/v1/quotes/[ref]/pay/route.ts: the quotes module landed in
 * 20260909000000 and is not in the generated src/lib/supabase/types.ts. Kept narrow so a typo in one
 * of these calls is still a compile error.
 * ------------------------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

interface ReadBuilder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): ReadBuilder;
  order(column: string, opts: { ascending: boolean }): ReadBuilder;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
}

interface WriteBuilder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): WriteBuilder;
  /** A null test. `.eq(col, null)` is not it — PostgREST needs `is` for that. */
  is(column: string, value: null): WriteBuilder;
  select(columns: string): WriteBuilder;
}

interface SendClient {
  from(table: 'quotes' | 'quote_items' | 'profiles'): {
    select(columns: string): ReadBuilder;
    update(payload: Row): WriteBuilder;
  };
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  // PostgREST answers in JSON, so a timestamp arrives as an ISO string and this branch never runs in
  // production. A wire-protocol driver (the PGlite test harness) hands back a Date, and `String(date)`
  // would turn a comparable timestamp into "Wed Aug 06 2026 …".
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

/** A `date` column, always `yyyy-mm-dd`: PostgREST answers exactly that, a wire driver a UTC Date. */
function dateText(value: unknown): string {
  return text(value).slice(0, 10);
}

/** `bigint` columns: PostgREST hands back a JSON number, other drivers a string or a BigInt. */
function minor(value: unknown): number {
  return Number(value ?? 0);
}

/**
 * The signed-in caller's business role, or null when they have no profile row.
 *
 * Read through the SERVICE-ROLE client on purpose: `profiles` is RLS-protected and this must be able
 * to answer for any caller, including one whose own policies would hide the column.
 */
async function callerRole(db: SendClient, userId: string): Promise<string | null> {
  const { data, error } = await db.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error)
    throw new Error(String((error as { message?: string }).message ?? 'profile read failed'));
  return textOrNull(data?.role ?? null);
}

export const POST = apiHandler(async (req) => {
  // Before the auth check, as on every other rate-limited route here. The budget being protected is
  // the mail provider's, and an unbounded loop against this endpoint would spam a real guest.
  await rateLimit(req, 'admin_quote_send', 20, 60);

  const user = await requireUser(req);
  const db = createServiceRoleClient() as unknown as SendClient;
  const role = await callerRole(db, user.id);
  if (!role || !SENDING_ROLES.has(role)) {
    throw new ForbiddenError('Staff only');
  }

  const { quoteId } = await parseJsonBody(req, bodySchema);

  // FAIL CLOSED on the site URL, like the payments routes: it builds the link that goes INTO the
  // email, and an email cannot be recalled. A deploy that forgot NEXT_PUBLIC_SITE_URL would send the
  // guest a localhost link.
  if (!isSiteUrlConfiguredForLive(getServerEnv())) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime. It builds the quote link that is emailed to the guest; refusing ' +
        'to send a link to localhost.',
      { code: 'site_url_not_configured' },
    );
  }

  // `internal_notes` and `token_hash` are deliberately NOT selected. Neither is needed to send, both
  // live on this row, and the same stance is why src/lib/email/quote.ts's input type names only
  // guest-facing fields: what is never loaded cannot be rendered by mistake.
  const { data: quote, error } = await db
    .from('quotes')
    .select(
      // `locale` is on this list for the same reason `currency` is: it is a property of the OFFER,
      // not of the operator pressing Send. api_convert_quote copies it into `bookings.locale`, which
      // already picks the language of the confirmation email and the VAT invoice — so leaving it
      // unselected would email a French guest an English quote and then French paperwork about it.
      // `deposit_bps` is on this list for the same reason `locale` is: it is a property of the OFFER
      // that the guest is entitled to read BEFORE accepting it. api_convert_quote charges only
      // round(total × bps / 10000) at the card form, so an email sent without it quotes a total and
      // then asks for a tenth of it, never mentioning the balance still owed.
      // `payment_mode` for the same reason `deposit_bps` is here: a 'per_date' quote charges the FIRST
      // activity date's sum, not total × bps, so the terms the email states to the guest depend on it.
      'id, ref, customer_name, customer_email, status, currency, total_minor, deposit_bps, ' +
        'payment_mode, valid_until, intro_note, converted_at, locale',
    )
    .eq('id', quoteId)
    .maybeSingle();
  if (error)
    throw new Error(String((error as { message?: string }).message ?? 'quote read failed'));
  if (!quote) throw new NotFoundError('This quote no longer exists.');

  const ref = text(quote.ref);
  const status = text(quote.status);
  const totalMinor = minor(quote.total_minor);

  // 1. Can this quote be sent at all? See SENDABLE_STATUSES.
  if (textOrNull(quote.converted_at) !== null || status === 'accepted') {
    throw new ConflictError(
      `Quote ${ref} has already been accepted, so it cannot be sent again — re-sending would mint a ` +
        `new link and break the one the guest is using to pay. Their booking is the live record now; ` +
        `find it on the bookings screen.`,
    );
  }
  if (!SENDABLE_STATUSES.has(status)) {
    throw new ConflictError(
      `Quote ${ref} is ${status === 'cancelled' ? 'withdrawn' : status}, so it cannot be emailed: ` +
        `${status === 'cancelled' ? 'its public page would not open at all, and' : ''} the payment ` +
        `path refuses to charge it. Draft a new quote for this guest instead.`,
    );
  }

  // 2. …and is it still inside its validity window? The second of the two call sites named in
  //    src/lib/quotes/validity.ts. The ref is passed so the refusal names the quote — saveQuote's
  //    call cannot, because at the keystroke there may not be one yet.
  assertQuoteStillValid(dateText(quote.valid_until), { ref });

  const { data: items, error: itemsError } = await db
    .from('quote_items')
    // `starts_at, subtotal_minor, transport_fare_minor` beyond what the email lines need: they build the
    // per_date schedule (computeQuoteSchedule), the same date-grouping api_convert_quote splits by.
    .select(
      'kind, description, price_label, quantity, unit_amount_minor, starts_at, subtotal_minor, ' +
        'transport_fare_minor',
    )
    // The email, the public page and booking_custom_items all read the lines in the owner's order.
    // Ordering by id would be ordering by gen_random_uuid().
    .order('position', { ascending: true })
    .eq('quote_id', quoteId);
  if (itemsError) {
    throw new Error(String((itemsError as { message?: string }).message ?? 'lines read failed'));
  }
  const lines = items ?? [];

  // 3. Nothing to charge. Each of the three is reachable and each produces an unpayable offer.
  if (lines.length === 0) {
    throw new ValidationError(
      `Quote ${ref} has no lines on it, so there is nothing itemised behind its total. Add the lines ` +
        `and save it before sending.`,
    );
  }
  if (totalMinor < 0) {
    throw new ValidationError(
      `Quote ${ref} has a negative total (${totalMinor} minor units). A card cannot be charged a ` +
        `negative amount; re-price the lines and save the quote again.`,
    );
  }
  if (totalMinor === 0) {
    throw new ValidationError(
      `Quote ${ref} totals nothing to charge. A zero-total quote mints a booking that can never ` +
        `confirm, so it would sit unpaid until it expired. Price at least one line before sending.`,
    );
  }

  // 4. The last refusal — a total that does not match its lines — belongs to renderQuoteEmail, which
  //    is also what prints the figure. Rendering happens BEFORE any write, so a refusal here leaves
  //    the quote exactly as the operator left it.
  const token = mintQuoteToken();
  const paymentMode = text(quote.payment_mode) === 'per_date' ? 'per_date' : 'deposit';
  // The per-date schedule the email discloses — built from the SAME lines, grouped the SAME way
  // api_convert_quote splits the booking, so `schedule[0]` is the exact figure the card is charged now.
  // Empty unless per_date (and even then only with dated lines), which is precisely when the email
  // should keep the % deposit terms — the RPC does the same.
  const schedule =
    paymentMode === 'per_date'
      ? computeQuoteSchedule(
          lines.map((line) => ({
            startsAt: textOrNull(line.starts_at),
            subtotalMinor: minor(line.subtotal_minor),
            transportFareMinor: minor(line.transport_fare_minor),
          })),
        )
      : [];
  const email = renderQuoteEmail({
    ref,
    customerName: text(quote.customer_name),
    currency: text(quote.currency),
    totalMinor,
    validUntil: dateText(quote.valid_until),
    // The column's own default, restated for a row written before it existed: a missing deposit must
    // read as the 10% the RPC would charge, never as 0 (a "pay EUR 0.00 to confirm" email).
    depositBps: Number(quote.deposit_bps ?? DEFAULT_DEPOSIT_BPS),
    paymentMode,
    schedule,
    introNote: textOrNull(quote.intro_note),
    // `content_locale` comes back as a plain string; renderQuoteEmail falls back to English for
    // anything that is not a locale it has messages for.
    locale: textOrNull(quote.locale),
    items: lines.map(
      (line): QuoteEmailLine => ({
        // A custom/rental line always has a description (`quote_item_shape` makes it NOT NULL for
        // those kinds). A CATALOGUE line need not: it is named by its tier, so the price label is
        // what the guest reads — and api_convert_quote makes the same substitution when it writes
        // the booking_items row, so the email and the voucher name the line identically.
        description: textOrNull(line.description) ?? text(line.price_label),
        quantity: Number(line.quantity ?? 0),
        unitAmountMinor: minor(line.unit_amount_minor),
        // Threaded through so quoteTotalMinor(items) matches the transport-inclusive stored total and the
        // email itemises the transfer — without it, any quote carrying a transfer fails the guard.
        transportFareMinor: minor(line.transport_fare_minor),
      }),
    ),
    linkToken: token,
  });

  // The write. `converted_at is null` is part of the UPDATE's own WHERE clause rather than a re-read:
  // the guest's pay route can convert between the check above and this statement, and rotating the
  // token then would break the link of someone already at the card form. Zero rows back means exactly
  // that happened (or the quote was erased); either way nothing has been emailed yet.
  const { data: updated, error: writeError } = await db
    .from('quotes')
    .update({
      token_hash: await hashQuoteToken(token),
      status: 'sent',
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', quoteId)
    .is('converted_at', null)
    .select('id');
  if (writeError) {
    throw new Error(String((writeError as { message?: string }).message ?? 'quote write failed'));
  }
  if (!updated || updated.length === 0) {
    throw new ConflictError(
      `Quote ${ref} was accepted or removed while it was being sent, so no email went out. Check the ` +
        `bookings screen before sending anything to this guest.`,
    );
  }

  const url = `${SITE.url}${quoteOpenPath(ref, token)}`;
  try {
    await getNotificationProvider().send({
      // A fresh id per send, never the quote's: the Resend provider keys its Idempotency-Key on it,
      // and a re-send is a DIFFERENT email carrying a different link that must actually go out.
      id: crypto.randomUUID(),
      channel: 'email',
      recipient: text(quote.customer_email),
      template: 'quote_sent',
      // A quote is a priced offer a guest should be able to just hit Reply to, so it is sent FROM the
      // monitored info@ inbox (SITE.email, overridable via QUOTE_FROM) instead of the send-only
      // bookings@ identity (RESEND_FROM). This per-message override leaves every other template —
      // every confirmation, refund and invoice — on RESEND_FROM. Reply-To is already info@.
      from: getServerEnv().QUOTE_FROM ?? SITE.email,
      // EMPTY, and it stays empty. The provider falls back to rendering from `payload` only when the
      // message carries no subject/text — this one carries both — and a payload is the sort of thing
      // that gets logged. The token appears in the rendered body and nowhere else.
      payload: {},
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (cause) {
    // 500 with a generic body, and the real reason in the logs + error_logs — the operator cannot fix
    // a mail outage from the quote editor, and the one thing they need to know (press Send again) is
    // true of every failure this route can return.
    throw new ProviderError(
      `Quote ${ref} could not be emailed: ${cause instanceof Error ? cause.message : 'send failed'}. ` +
        `The quote is marked sent but nobody holds its link; pressing Send again mints a fresh one.`,
    );
  }

  // The raw token's second and last home. The operator pastes this to a guest who asks for the link
  // over WhatsApp; it is not stored anywhere on our side.
  return jsonOk({ url });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
