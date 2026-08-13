import { quoteTokenMatches } from './token';
import { installmentTokenMatches } from './installment-token';
import { DEFAULT_DEPOSIT_BPS } from './deposit';
import { computeQuoteSchedule, type QuoteInstallmentPreview } from './payment-schedule';
import { createServiceRoleClient } from '@/lib/supabase/admin';

/**
 * The read behind the PUBLIC quote page — /quotes/{ref}, authenticated by the httpOnly link-token
 * cookie that GET /api/v1/quotes/{ref}/open sets (see src/lib/quotes/link-cookie.ts for why the token
 * is never in the page's own URL).
 *
 * This function IS the authorization. The guest has no account (that is the point of the emailed
 * link), so there is no session to check, no `auth.uid()` to compare against, and the staff RLS
 * policies of 20260909000000 are `to authenticated` only — meaning the read has to run with the
 * service-role client, which bypasses RLS outright. Nothing stands behind this check.
 *
 * IT FAILS CLOSED, and returns the SAME answer — null — for every refusal:
 *
 *   - no row with that `ref`;
 *   - a token that does not hash to the stored `token_hash`;
 *   - a row whose `token_hash` is null (a draft that was never sent — the column is nullable and only
 *     the send route ever fills it);
 *   - status `cancelled`, i.e. the operator withdrew the offer — WHILE IT IS STILL AN OFFER;
 *   - `valid_until` already past — likewise;
 *   - no `quote_items` at all, i.e. a total with no itemisation behind it.
 *
 * ONE indistinguishable answer, never a different status code per case. `quotes.ref` is the path
 * segment of a link that gets forwarded, quoted in replies and pasted into chats; answering "404 no
 * such quote" for one ref and "403 wrong token" for another turns the page into an oracle for which
 * refs exist. The caller therefore has exactly one branch: a quote, or the not-found page.
 *
 * What it deliberately does NOT do is decide payability beyond those five. `draft` and `expired`
 * statuses are left to api_convert_quote, which owns the whitelist ('sent', 'accepted') and every
 * money-path guard behind it; duplicating that list here would be a second copy to keep in step with
 * the one that actually protects the charge. The two conditions mirrored here are the ones that mean
 * "there is nothing to show", not "this cannot be charged".
 *
 * WHICH IS WHY BOTH OF THEM STOP AT `converted_at`. Once the quote has converted there IS something to
 * show — a booking, possibly a paid one — and this page is the ONE record a guest with no account can
 * see. `valid_until` is a calendar day compared in UTC, so a guest who pays at 23:5x UTC on the last
 * valid day and is bounced back by the card form would otherwise land on a 404 instead of their
 * payment screen, and every later visit to the link would 404 too; withdrawing a quote whose booking
 * already exists likewise hides the guest's own record without un-charging anything (api_convert_quote
 * is what refuses to mint again — `quote_cancelled` — and it still does). The token is unchanged as
 * the gate, and every OTHER refusal is still the same single null, so the no-oracle property stands.
 *
 * The returned model carries ONLY guest-facing fields — the same privacy stance, and for the same
 * reason, as src/lib/email/quote.ts: `internal_notes` ("margin is thin, don't discount further") lives
 * on the same row, and so does `token_hash`. Nothing here filters them out; they are never selected.
 */

/** One priced line of the offer, in the owner's order. */
export interface PublicQuoteLine {
  position: number;
  /** Free text the operator typed. Null only on a catalogue line, which carries `priceLabel`. */
  description: string | null;
  priceLabel: string | null;
  /** The line's own date/time, for a custom line that has no session occurrence. */
  startsAt: string | null;
  endsAt: string | null;
  quantity: number;
  unitAmountMinor: number;
  subtotalMinor: number;
}

/** The offer as the guest may see it. See the PRIVACY note above before adding a field. */
export interface PublicQuote {
  ref: string;
  customerName: string;
  currency: string;
  /** Minor units, like the rest of the quotes module — the figure the card is charged. */
  totalMinor: number;
  /**
   * The share of the total that CONFIRMS the booking, in basis points (1000 = 10%; 10000 =
   * pay-in-full). The guest is charged `round(total × bps / 10000)` at the card form, so the page
   * that asks them to accept has to state it — otherwise the only place the real figure appears is
   * the payment form itself.
   */
  depositBps: number;
  /** A calendar day, `yyyy-mm-dd`, never an instant. */
  validUntil: string;
  /** The operator's covering note TO the guest. The internal one is a different column. */
  introNote: string | null;
  /**
   * When the guest accepted this offer and a booking was minted, ISO — null while it is still an offer.
   *
   * The page needs it because the link gets FORWARDED: to a partner, to a travel agent, or simply
   * reopened by the guest after paying. Rendering an unqualified "Accept & pay" to someone whose
   * booking already exists invites a second attempt whose only possible answer is a raw
   * `quote_already_converted` refusal. (api_convert_quote's `for update` convert-once guard means it
   * cannot mint a second payable booking — this is comprehension, not double-charge — but a money
   * screen is the wrong place to be vague.)
   *
   * Read off `converted_at`, never `booking_id`: the migration's section 4 states the contract, because
   * api_erase_user hard-deletes an unpaid booking and the `on delete set null` FK then silently clears
   * `booking_id` while `converted_at` stays.
   */
  convertedAt: string | null;
  /**
   * The state of the booking this quote minted — null while it is still an offer, and null too if
   * that booking has been erased (api_erase_user hard-deletes an unpaid one).
   *
   * THE PAGE HAS NO OTHER PROOF THAT MONEY ARRIVED. EmbeddedCheckout sends the guest back with
   * `?just_paid=1` whenever it could not confirm the payment itself, which for a quote guest is
   * ALWAYS (/api/v1/payments/sync needs a bearer token and they have no account) — so that flag means
   * "a card was submitted", never "it worked", and a declined card or an abandoned 3-D Secure step
   * carries the identical `1`. Reading these two columns is what lets the page thank the guest who
   * really paid and keep the way to pay open for the one who did not.
   */
  booking: PublicQuoteBooking | null;
  items: PublicQuoteLine[];
  /**
   * How the guest pays: 'deposit' (a % of the total up front, the balance chased later) or 'per_date'
   * (one payment per activity DATE — the first secures every seat, the rest fall due before each date).
   * The page and the email state DIFFERENT terms for each, so this drives which; see {@link schedule}.
   */
  paymentMode: 'deposit' | 'per_date';
  /**
   * The per-date schedule the guest is being asked to accept — non-empty ONLY for a `per_date` quote
   * that has dated lines. seq 0 is due now (the deposit that secures the seats); each later entry falls
   * due before its date. EMPTY for a deposit quote (and for a per_date quote with no dated line, which
   * api_convert_quote itself converts as a % deposit) — then the page states `depositBps` instead.
   *
   * Derived by {@link computeQuoteSchedule} the same way api_convert_quote splits the booking, so the
   * "due now" shown here is the exact figure the card is charged. A parity test pins the two together.
   */
  schedule: QuoteInstallmentPreview[];
}

/** The converted booking as the guest may see it: its lifecycle state, and nothing else off the row. */
export interface PublicQuoteBooking {
  /** `bookings.status` — 'payment_pending', 'confirmed', 'cancelled', … */
  status: string;
  /** `bookings.payment_state` — the cached projection of the payment_events ledger. */
  paymentState: string;
}

/**
 * `payment_state` values that mean the money actually reached us. `refunded` / `partially_refunded`
 * are in here on purpose: that money arrived and was sent back, which is many things but never
 * "pay us now", so those bookings must not be shown a live charge affordance either.
 *
 * THAT IS A STATEMENT ABOUT THE BUTTON, NOT ABOUT THE WORDING. Reading this set as "the payment
 * succeeded, say thank you" is what put a refunded guest in front of "Thank you — your payment has
 * been received… we are confirming it now, and your confirmation email is on its way", with no
 * mention anywhere on the page that the money had gone back. {@link quoteRefundState} is the second
 * question the page must ask, and the two answers are independent: no charge affordance, honest
 * words.
 */
const PAID_PAYMENT_STATES = new Set(['paid', 'partially_refunded', 'refunded']);

/** How much of the money went back. `null` is "none of it", not "unknown". */
export type QuoteRefundState = 'refunded' | 'partially_refunded';

/** The `payment_state` values that say a refund has actually been issued. */
const REFUNDED_PAYMENT_STATES = new Set<string>(['refunded', 'partially_refunded']);

/** Statuses a booking only reaches after a verified payment (the webhook sets `confirmed`). */
const SETTLED_BOOKING_STATUSES = new Set(['confirmed', 'completed']);

/**
 * Has this quote's payment actually completed? The question the public page must ask before it says
 * anything at all about the guest's money.
 *
 * FALSE for everything it cannot prove — no booking, an unreadable one, `payment_pending`/`pending`
 * — because the two errors are not symmetric. A false "not yet" costs a guest one reload; a false
 * "received" tells someone whose card was declined that there is nothing left to do and takes the pay
 * button off their screen.
 */
export function quotePaymentReceived(quote: PublicQuote): boolean {
  const booking = quote.booking;
  if (!booking) return false;
  return (
    PAID_PAYMENT_STATES.has(booking.paymentState) || SETTLED_BOOKING_STATUSES.has(booking.status)
  );
}

/**
 * Has this quote's payment been refunded, in whole or in part? Null when it has not.
 *
 * Asked only of a booking {@link quotePaymentReceived} already answered true for — a refund is by
 * definition money that arrived first. It exists so the page can say what happened instead of
 * thanking someone for a payment it has since given back: that guest is not waiting on a
 * confirmation email, and telling them "there is nothing else for you to do" while showing no sign
 * of the refund reads as the booking still being on.
 *
 * Read off `payment_state` ONLY, never `status`: `payment_state` is the projection of the
 * payment_events ledger, i.e. the money itself, while `status` carries the booking's lifecycle and
 * has a `refund_pending` value that means the OPPOSITE of settled — the owner still owes the money
 * back and refunds it by hand in Peach. Calling that "refunded" on the guest's one visible record
 * would be a promise the ledger does not support.
 */
export function quoteRefundState(quote: PublicQuote): QuoteRefundState | null {
  const state = quote.booking?.paymentState;
  if (!state || !REFUNDED_PAYMENT_STATES.has(state)) return null;
  return state as QuoteRefundState;
}

/* ---------------------------------------------------------------------------------------------
 * The typed client does not know these tables.
 *
 * The quotes module's tables landed in 20260909000000 and are not in the generated
 * src/lib/supabase/types.ts (regenerating it needs a live database and would sweep in every other
 * pending schema change), so `from('quotes')` does not typecheck against `Database`. Same structural
 * cast as src/lib/admin/delete-guards.ts, kept narrow so a typo in one of these calls is still a
 * compile error.
 * ------------------------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
type Rows = { data: Row[] | null; error: unknown };

interface QuotesReadClient {
  from(table: 'quotes' | 'quote_items' | 'bookings' | 'booking_installments'): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
        order(column: string, opts: { ascending: boolean }): PromiseLike<Rows>;
      };
    };
  };
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  // PostgREST answers in JSON, so a timestamp arrives as an ISO string and this branch never runs in
  // production. A driver that speaks the wire protocol (the PGlite test harness) hands back a Date,
  // and `String(date)` would turn a sortable timestamp into "Wed Aug 06 2026 …".
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
 * Today as `yyyy-mm-dd` in UTC — deliberately the same clock Postgres reads.
 *
 * api_convert_quote refuses on `valid_until < current_date`, evaluated in the database's session
 * timezone, which is UTC on Supabase. Using the worker's local notion of "today" (or Mauritius time,
 * UTC+4) would let this function and the RPC disagree for a few hours a day — the page showing an
 * offer the Pay button then refuses, or hiding one that was still chargeable.
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const QUOTE_COLUMNS =
  // `deposit_bps` is guest-facing: api_convert_quote charges only round(total × bps / 10000) at the
  // card form, so the page that asks the guest to accept the offer has to be able to say so.
  // `payment_mode` for the same reason: 'per_date' charges the FIRST activity date's sum, not the %
  // deposit, so the terms shown to the guest depend on it (see the schedule build below).
  'id, ref, customer_name, status, currency, total_minor, deposit_bps, payment_mode, valid_until, ' +
  'intro_note, token_hash, converted_at, booking_id';

const ITEM_COLUMNS =
  // `transport_fare_minor`: part of a line's date-total (Σ subtotal + Σ transport) and of the quote
  // total, so the per_date schedule must fold it in — otherwise a date carrying a transfer under-states.
  'position, description, price_label, starts_at, ends_at, quantity, unit_amount_minor, ' +
  'subtotal_minor, transport_fare_minor';

/**
 * The converted booking's state, or null.
 *
 * NULL FOR A FAILED READ TOO, and that is the safe direction: {@link quotePaymentReceived} answers
 * false for a null booking, so a database fault leaves the guest with an honest "not confirmed yet"
 * and a live pay button, never a thank-you the row does not support.
 *
 * Nothing off this row reaches the guest but the two lifecycle columns — `bookings` carries the
 * customer's own contact details, the pricing breakdown and `notes`, and this model is serialised
 * into a page the recipient of a forwarded link can read. Same stance as the quote row above.
 */
async function readBookingState(
  db: QuotesReadClient,
  bookingId: string | null,
): Promise<PublicQuoteBooking | null> {
  if (!bookingId) return null;
  const { data, error } = await db
    .from('bookings')
    .select('status, payment_state')
    .eq('id', bookingId)
    .maybeSingle();
  if (error || !data) return null;
  return { status: text(data.status), paymentState: text(data.payment_state) };
}

/**
 * The quote behind a public link, or null.
 *
 * Every refusal is the same null — see the module header. Called by the public page (server side) and
 * by the pay route, which turns the null into its 404.
 */
export async function resolveQuoteForToken(
  ref: string,
  token: string,
): Promise<PublicQuote | null> {
  // A token that is not 32 bytes of lowercase hex can never match a stored SHA-256, so it costs a
  // database round trip to prove it. This is where an absent `?t=` lands.
  if (!ref || !/^[0-9a-f]{64}$/.test(token)) return null;

  const db = createServiceRoleClient() as unknown as QuotesReadClient;

  const { data, error } = await db
    .from('quotes')
    .select(QUOTE_COLUMNS)
    .eq('ref', ref)
    .maybeSingle();
  // A read that FAILED is not a quote that does not exist, but the caller has one branch by design,
  // and answering "no" to a transient database fault is the fail-closed direction.
  if (error || !data) return null;

  // Constant-time, and false on a null stored hash — an unsent draft is not openable by anyone.
  if (!(await quoteTokenMatches(token, textOrNull(data.token_hash)))) return null;

  const convertedAt = textOrNull(data.converted_at);
  // The two "there is nothing to show" refusals — and only while that is true. Once the quote has
  // converted, hiding the page hides the guest's own booking from the one screen they can reach; see
  // the module header for the 23:5x-UTC case that makes it a payment dead end rather than a nicety.
  // Every refusal is still the same null, converted or not.
  if (!convertedAt) {
    if (text(data.status) === 'cancelled') return null;
    if (dateText(data.valid_until) < todayUtc()) return null;
  }

  // A second read rather than a PostgREST embed: the lines must come back ordered by `position`, and
  // an embedded relation arrives unordered — ordering by id would be ordering by gen_random_uuid().
  const { data: items, error: itemsError } = await db
    .from('quote_items')
    .select(ITEM_COLUMNS)
    .eq('quote_id', text(data.id))
    .order('position', { ascending: true });
  // The lines ARE the offer: showing a total with no itemisation behind it is how a guest ends up
  // paying a figure they cannot check. Refuse the whole page instead.
  if (itemsError) return null;
  // NO lines is that same harm, reached from the other side — and it is a state this repo documents as
  // REACHABLE, not a hypothetical. saveQuote (src/lib/admin/quotes.ts) writes `total_minor`, DELETEs
  // every line and re-INSERTs them in three non-transactional PostgREST statements, and its own doc
  // comment names the failure: a stale occurrence id raises 23503 on the re-insert, AFTER the new total
  // is written and the old lines are gone. A guest loading the link in that window would read "Total
  // EUR 230.00" over an empty list; if the re-insert failed outright, indefinitely, with a live link.
  //
  // It is also unchargeable, so there is nothing to lose by refusing: api_convert_quote sums the lines
  // and raises `quote_total_mismatch` on any disagreement with `total_minor`, and its own comment says
  // the check subsumes exactly this case ("a hand-set total with no itemisation at all").
  if ((items ?? []).length === 0) return null;

  // Read LAST: it is only ever set on a converted quote, and every refusal above has already run.
  const booking = await readBookingState(
    db,
    data.booking_id == null ? null : text(data.booking_id),
  );

  return {
    ref: text(data.ref),
    customerName: text(data.customer_name),
    currency: text(data.currency),
    totalMinor: minor(data.total_minor),
    // The column's own default for a row written before it existed — never 0, which would render
    // "pay EUR 0.00 to confirm" on the guest's own money screen.
    depositBps: Number(data.deposit_bps ?? DEFAULT_DEPOSIT_BPS),
    validUntil: dateText(data.valid_until),
    introNote: textOrNull(data.intro_note),
    convertedAt,
    booking,
    items: (items ?? []).map((row) => ({
      position: Number(row.position ?? 0),
      description: textOrNull(row.description),
      priceLabel: textOrNull(row.price_label),
      startsAt: textOrNull(row.starts_at),
      endsAt: textOrNull(row.ends_at),
      quantity: Number(row.quantity ?? 0),
      unitAmountMinor: minor(row.unit_amount_minor),
      subtotalMinor: minor(row.subtotal_minor),
    })),
    paymentMode: text(data.payment_mode) === 'per_date' ? 'per_date' : 'deposit',
    // The schedule is built from the SAME lines the page renders, grouped exactly as api_convert_quote
    // groups them — so the "due now" it shows is the figure the card is charged. Empty unless per_date,
    // and empty even then if no line is dated (the RPC falls back to the % deposit; the page follows).
    schedule:
      text(data.payment_mode) === 'per_date'
        ? computeQuoteSchedule(
            (items ?? []).map((row) => ({
              startsAt: textOrNull(row.starts_at),
              subtotalMinor: minor(row.subtotal_minor),
              transportFareMinor: minor(row.transport_fare_minor),
            })),
          )
        : [],
  };
}

/**
 * The balance a guest still owes, as the DURABLE balance page (/quotes/{ref}/balance) may show it.
 *
 * GUEST-FACING FIELDS ONLY — the same privacy stance, and for the same reason, as {@link PublicQuote}:
 * `internal_notes` ("margin is thin, don't discount further") lives on this very quote row and is
 * never selected here, and the booking's own contact details, pricing breakdown and notes are not read
 * at all. Nothing here filters them out; they are never loaded.
 */
export interface PublicQuoteBalance {
  /** The QUOTE ref — the path segment the balance page and its pay route are keyed on. */
  ref: string;
  customerName: string;
  currency: string;
  /** Minor units — the amount still owed, the figure the balance checkout will charge. */
  balanceDueMinor: number;
}

/** `internal_notes` and `token_hash` are deliberately absent — see {@link PublicQuoteBalance}. */
const BALANCE_QUOTE_COLUMNS = 'id, ref, customer_name, currency, booking_id, balance_token_hash';

/**
 * The balance behind a DURABLE balance link, or null.
 *
 * The balance's analogue of {@link resolveQuoteForToken}, and it fails closed in the exact same shape:
 * ONE indistinguishable null for every refusal — unknown ref, a token that does not hash to the stored
 * `balance_token_hash`, a null stored hash (staff never sent a balance link, or a pay-in-full quote
 * that owes nothing), no booking behind the quote, a booking that is not `confirmed`, and a fully-paid
 * one. `quotes.ref` is the path segment of a link that gets forwarded, so a per-case status would turn
 * the balance page into an existence oracle just as it would the quote page; the caller therefore has
 * exactly one branch, a balance or the not-found page.
 *
 * The token matched is `balance_token_hash`, NEVER `token_hash`: the deposit link and the balance link
 * are separate credentials on the same row, so opening one never opens the other, and minting a
 * balance link (which writes only `balance_token_hash`) never touches the deposit link the guest is
 * still holding.
 *
 * The two payability conditions — confirmed, and `balance_due_minor > 0` — mirror create_payment's own
 * 'balance' branch, so the page never renders a Pay button the charge would then reject. They are the
 * balance's "there is nothing to collect" refusals, the counterpart of the quote page's cancelled /
 * lapsed pair.
 */
export async function resolveBalanceForToken(
  ref: string,
  token: string,
): Promise<PublicQuoteBalance | null> {
  // A token that is not 32 bytes of lowercase hex can never match a stored SHA-256. This is where an
  // absent `?t=` (and the cookie a wrong token was skipped from) lands.
  if (!ref || !/^[0-9a-f]{64}$/.test(token)) return null;

  const db = createServiceRoleClient() as unknown as QuotesReadClient;

  const { data, error } = await db
    .from('quotes')
    .select(BALANCE_QUOTE_COLUMNS)
    .eq('ref', ref)
    .maybeSingle();
  // A read that FAILED is not a quote that does not exist, but the caller has one branch by design,
  // and answering "no" to a transient database fault is the fail-closed direction.
  if (error || !data) return null;

  // Constant-time, and false on a null stored hash — a quote with no balance link is not openable.
  if (!(await quoteTokenMatches(token, textOrNull(data.balance_token_hash)))) return null;

  // No booking behind the quote (never paid, or the deposit booking was erased and the FK nulled the
  // pointer): there is no balance to collect. Same single null.
  const bookingId = data.booking_id == null ? null : text(data.booking_id);
  if (!bookingId) return null;

  const { data: booking, error: bookingError } = await db
    .from('bookings')
    .select('status, balance_due_minor')
    .eq('id', bookingId)
    .maybeSingle();
  if (bookingError || !booking) return null;

  // Payable ONLY on a confirmed booking that still owes something. A booking that is not confirmed
  // (cancelled, refunded, expired) and a fully-paid one (balance_due_minor <= 0, the balance already
  // collected) are BOTH refused — the same single null, no oracle.
  const status = text(booking.status);
  const balanceDueMinor = minor(booking.balance_due_minor);
  if (status !== 'confirmed') return null;
  if (balanceDueMinor <= 0) return null;

  return {
    ref: text(data.ref),
    customerName: text(data.customer_name),
    currency: text(data.currency),
    balanceDueMinor,
  };
}

/**
 * One dated installment on a per-date scheduled booking, as its durable pay-link may show it.
 * GUEST-FACING fields only, the same privacy stance as {@link PublicQuoteBalance}.
 */
export interface PublicInstallment {
  /** The QUOTE ref — the path segment the installment page + pay route are keyed on. */
  ref: string;
  /** The BOOKING ref — what the pay route hands createPaymentLink. */
  bookingRef: string;
  customerName: string;
  currency: string;
  seq: number;
  label: string;
  /** yyyy-mm-dd — the activity's Mauritius-local date. */
  dueOn: string;
  /** Minor units — what THIS link will charge: the running total up to this installment minus what is
   *  already settled (covers any earlier overdue one too), exactly what create_payment will size the row
   *  to. Server-derived, never client input. */
  chargeMinor: number;
}

/**
 * The installment behind a durable per-installment link, or null.
 *
 * The installment analogue of {@link resolveBalanceForToken}, failing closed in the SAME single-null
 * shape for every refusal — unknown ref, no booking, a not-confirmed booking, a token that does not
 * match the deterministic HMAC over (bookingId, seq), an unknown seq, and an installment already covered
 * (chargeMinor <= 0). One indistinguishable "not found", never an existence oracle.
 *
 * The token is NOT a stored hash: an installment link is a deterministic HMAC recomputed here (see
 * src/lib/quotes/installment-token.ts), which is what lets the reminder cron send it without persisting
 * a raw token. The two payability conditions (confirmed, chargeMinor > 0) mirror create_payment's own
 * per-installment branch, so the page never shows a Pay button the charge would then reject.
 */
export async function resolveInstallmentForToken(
  ref: string,
  seq: number,
  token: string,
): Promise<PublicInstallment | null> {
  if (!ref || !Number.isInteger(seq) || seq < 0 || !/^[0-9a-f]{64}$/.test(token)) return null;

  const db = createServiceRoleClient() as unknown as QuotesReadClient;

  const { data: quote, error } = await db
    .from('quotes')
    .select('id, ref, customer_name, currency, booking_id')
    .eq('ref', ref)
    .maybeSingle();
  if (error || !quote) return null;
  const bookingId = quote.booking_id == null ? null : text(quote.booking_id);
  if (!bookingId) return null;

  // The credential IS a deterministic HMAC over (bookingId, seq) — no stored hash. Constant-time, fail-closed.
  if (!(await installmentTokenMatches(bookingId, seq, token))) return null;

  const { data: booking, error: bErr } = await db
    .from('bookings')
    .select('ref, status, total_minor, balance_due_minor')
    .eq('id', bookingId)
    .maybeSingle();
  if (bErr || !booking) return null;
  const status = text(booking.status);
  const totalMinor = minor(booking.total_minor);
  const balanceDueMinor = minor(booking.balance_due_minor);
  if (status !== 'confirmed' || balanceDueMinor <= 0) return null;

  // The schedule (service-read, RLS-immune). The charge is the waterfall create_payment recomputes.
  const { data: rows, error: iErr } = await db
    .from('booking_installments')
    .select('seq, amount_minor, due_on, label')
    .eq('booking_id', bookingId)
    .order('seq', { ascending: true });
  if (iErr || !rows) return null;
  const inst = rows.find((r) => Number(r.seq) === seq);
  if (!inst) return null;
  const cumulative = rows
    .filter((r) => Number(r.seq) <= seq)
    .reduce((sum, r) => sum + minor(r.amount_minor), 0);
  const settled = totalMinor - balanceDueMinor;
  const chargeMinor = Math.max(0, Math.min(balanceDueMinor, cumulative - settled));
  if (chargeMinor <= 0) return null; // already covered — same single null, no oracle

  return {
    ref: text(quote.ref),
    bookingRef: text(booking.ref),
    customerName: text(quote.customer_name),
    currency: text(quote.currency),
    seq,
    label: text(inst.label),
    dueOn: dateText(inst.due_on),
    chargeMinor,
  };
}
