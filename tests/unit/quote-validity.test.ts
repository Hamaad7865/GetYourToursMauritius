import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertQuoteStillValid, quoteTodayUtc } from '@/lib/quotes/validity';

/**
 * The validity window, as a refusal rather than a display field.
 *
 * `quotes.valid_until` is not decoration: api_convert_quote raises `quote_expired` on
 * `valid_until < current_date`, and resolveQuoteForToken hides the public page outright once the day
 * has gone by. So an offer whose date has passed is one nobody can open and nobody can pay — while
 * the editor and the send path would happily go on treating it as a live draft, emailing a priced
 * offer above a dead link.
 *
 * Two callers, one rule:
 *   * saveQuote — refuse before anything is written, so the operator fixes the date now;
 *   * the send path — RE-CHECK immediately before renderQuoteEmail, because a quote can be drafted
 *     on Friday and sent on Monday, and send is the last human-visible moment before the guest holds
 *     the link. renderQuoteEmail itself stays pure (no clock), which is exactly why the check lives
 *     here and not inside it.
 */

describe('assertQuoteStillValid', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a date that has already gone by', () => {
    expect(() => assertQuoteStillValid('2026-08-05', { today: '2026-08-06' })).toThrow(
      /2026-08-05/,
    );
  });

  it('accepts the last day, because api_convert_quote compares with < and not <=', () => {
    // The boundary is load-bearing: refusing "today" here would make the guard stricter than the
    // charge it exists to predict, and an offer valid until today is still payable all day.
    expect(() => assertQuoteStillValid('2026-08-06', { today: '2026-08-06' })).not.toThrow();
    expect(() => assertQuoteStillValid('2026-12-31', { today: '2026-08-06' })).not.toThrow();
  });

  it('names the quote when the caller has one — the send path always does', () => {
    expect(() =>
      assertQuoteStillValid('2026-08-01', { ref: 'QAB12CD', today: '2026-08-06' }),
    ).toThrow(/QAB12CD/);
  });

  it('tolerates a timestamp-shaped value from a wire-protocol driver', () => {
    // PostgREST answers a `date` column as 'yyyy-mm-dd'; a driver that speaks the wire protocol
    // hands back a Date at UTC midnight, whose ISO form starts with the same ten characters.
    expect(() =>
      assertQuoteStillValid('2026-08-05T00:00:00.000Z', { today: '2026-08-06' }),
    ).toThrow(/2026-08-05/);
  });

  it('reads today in UTC — the clock current_date reads on Supabase', () => {
    // Late on the 6th UTC is already the 7th in Mauritius (UTC+4). Taking the worker's local day
    // would make this guard and api_convert_quote disagree for a few hours every day: an offer
    // refused here that the database would still charge, or the reverse.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T23:30:00Z'));
    expect(quoteTodayUtc()).toBe('2026-08-06');
    expect(() => assertQuoteStillValid('2026-08-06')).not.toThrow();
    expect(() => assertQuoteStillValid('2026-08-05')).toThrow();
  });
});
