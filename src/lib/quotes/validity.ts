import { ValidationError } from '@/lib/services/errors';

/**
 * The one place that decides whether a quote's validity window is still open.
 *
 * `quotes.valid_until` is not a display field. api_convert_quote raises `quote_expired` on
 * `valid_until < current_date`, and resolveQuoteForToken (src/lib/quotes/resolve.ts) refuses the
 * public page outright once the day has gone by — so an offer whose date has passed is one nobody
 * can open and nobody can pay. Nothing, however, stopped one being SAVED with a past date or EMAILED
 * after its date went by, which puts a priced offer in a guest's inbox above a link whose only
 * possible answer is a refusal.
 *
 * Two callers, one rule:
 *
 *   * `saveQuote` (src/lib/admin/quotes.ts) — refuse before any statement is issued, so the operator
 *     fixes the date while they are still looking at the form.
 *   * THE SEND PATH — re-check immediately before `renderQuoteEmail`. Not the same moment at all: a
 *     quote drafted on Friday and sent on Monday passed the save check and is dead by the time the
 *     email goes out, and send is the last human-visible instant before the guest holds the link.
 *     `renderQuoteEmail` already refuses the other two ways a stored total can be unchargeable (it
 *     drifts from the lines, or it is zero) and stays deliberately PURE — no clock, no I/O — which
 *     is precisely why this third refusal lives here and is called before it rather than inside it.
 *
 * Pure: the clock is read in `quoteTodayUtc`, and callers may hand a day in instead so tests stay
 * deterministic.
 */

/**
 * Today as `yyyy-mm-dd` in UTC — deliberately the same clock Postgres reads.
 *
 * api_convert_quote compares against `current_date`, evaluated in the database's session timezone,
 * which is UTC on Supabase. Using the worker's local notion of "today" (or Mauritius time, UTC+4)
 * would let this guard and the RPC disagree for a few hours a day: an offer refused here that the
 * database would still charge, or one waved through that it would not. Mirrors `todayUtc` in
 * src/lib/quotes/resolve.ts, which hides the public page on the same boundary.
 */
export function quoteTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** How long a fresh offer stands, in days. Two weeks: long enough to be answered, short enough that
 *  a quoted departure has probably not moved. The operator can change it on every quote. */
export const QUOTE_VALIDITY_DAYS = 14;

/**
 * `today + 14 days`, as `yyyy-mm-dd`.
 *
 * UTC arithmetic, matching `quoteTodayUtc` — api_convert_quote compares `valid_until` against
 * Postgres's `current_date` (UTC on Supabase), so a default computed from a local midnight would be
 * a day out for an operator in Mauritius (UTC+4) for part of every day.
 *
 * Two callers, and they are the same decision seen twice: `emptyQuoteForm` dates a NEW offer, and
 * `duplicateQuote` re-dates a COPY of one whose own window has closed — which is precisely the quote
 * an operator would otherwise retype. It lives here rather than in the editor because the second
 * caller is a lib function, and because the rule that reads the date (`assertQuoteStillValid`, below)
 * is the rule that decides what a usable one is.
 */
export function defaultValidUntil(today: string = quoteTodayUtc()): string {
  const day = new Date(`${today.slice(0, 10)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + QUOTE_VALIDITY_DAYS);
  return day.toISOString().slice(0, 10);
}

export interface QuoteValidityOptions {
  /** The quote's public ref, when the caller has one — the send path always does. */
  ref?: string | null;
  /** Today as `yyyy-mm-dd`; defaults to {@link quoteTodayUtc}. */
  today?: string;
}

/**
 * Throw a {@link ValidationError} when `validUntil` has already gone by.
 *
 * The comparison is `<`, not `<=`, matching api_convert_quote exactly: an offer valid UNTIL today is
 * still payable all day, and a guard stricter than the charge it predicts would refuse offers the
 * database would happily convert.
 *
 * `validUntil` is sliced to ten characters first. PostgREST answers a `date` column as
 * 'yyyy-mm-dd'; a driver that speaks the wire protocol hands back a timestamp whose ISO form starts
 * with the same ten characters, and comparing those two shapes as whole strings would silently
 * mis-order them.
 */
export function assertQuoteStillValid(
  validUntil: string,
  options: QuoteValidityOptions = {},
): void {
  const day = String(validUntil ?? '').slice(0, 10);
  const today = options.today ?? quoteTodayUtc();
  if (!day || day >= today) return;
  const subject = options.ref ? `Quote ${options.ref}` : 'This quote';
  throw new ValidationError(
    `${subject} is only valid until ${day}, which has already passed. api_convert_quote refuses to ` +
      `charge a quote whose valid_until is in the past (quote_expired) and the public quote page ` +
      `will not open at all, so the guest would be given a priced offer above a link that can only ` +
      `turn them away. Move the valid-until date forward first.`,
  );
}
