import { quoteTokenMatches } from './token';
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
 *   - status `cancelled`, i.e. the operator withdrew the offer;
 *   - `valid_until` already past;
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
  items: PublicQuoteLine[];
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
  from(table: 'quotes' | 'quote_items'): {
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
  'id, ref, customer_name, status, currency, total_minor, valid_until, intro_note, token_hash, ' +
  'converted_at';

const ITEM_COLUMNS =
  'position, description, price_label, starts_at, ends_at, quantity, unit_amount_minor, ' +
  'subtotal_minor';

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
  if (text(data.status) === 'cancelled') return null;
  if (dateText(data.valid_until) < todayUtc()) return null;

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

  return {
    ref: text(data.ref),
    customerName: text(data.customer_name),
    currency: text(data.currency),
    totalMinor: minor(data.total_minor),
    validUntil: dateText(data.valid_until),
    introNote: textOrNull(data.intro_note),
    convertedAt: textOrNull(data.converted_at),
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
  };
}
