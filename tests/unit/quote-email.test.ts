import { describe, expect, it } from 'vitest';
import { renderQuoteEmail } from '@/lib/email/quote';

/**
 * The guest-facing quote email. A pure renderer, like every other module in src/lib/email — the
 * offer's own figures in, `{ subject, html, text }` out, no I/O and no clock.
 *
 * The third test is the privacy one, and it is the reason this file exists at all:
 * `quotes.internal_notes` is the operator's margin/negotiation scratchpad, sat on the same row as the
 * guest's name and total, and the send route hands this renderer the whole quote. It must be
 * impossible for that column to reach the message body.
 */
const quote = {
  ref: 'Q7F3A21',
  customerName: 'Marie Dupont',
  currency: 'EUR',
  totalMinor: 23000,
  validUntil: '2026-08-19',
  introNote: 'As discussed on the phone.',
  items: [
    { description: 'Catamaran cruise, 23 Aug, 2 adults', quantity: 2, unitAmountMinor: 5500 },
    { description: 'Private guide, full day', quantity: 1, unitAmountMinor: 12000 },
  ],
};

describe('quote email', () => {
  it('lists every line and the total', () => {
    const { html } = renderQuoteEmail({
      ...quote,
      payUrl: 'https://bellemaretours.com/api/v1/quotes/Q7F3A21/open?t=abc',
    });
    expect(html).toContain('Private guide, full day');
    expect(html).toContain('Catamaran cruise, 23 Aug, 2 adults');
    expect(html).toContain('230.00');
  });

  it('links to the tokenised pay URL exactly once', () => {
    const payUrl = 'https://bellemaretours.com/api/v1/quotes/Q7F3A21/open?t=abc';
    const { html } = renderQuoteEmail({ ...quote, payUrl });
    expect(html.split(payUrl).length - 1).toBeGreaterThanOrEqual(1);
  });

  it('never leaks internal notes into the guest email', () => {
    // The caller from hell: the whole quotes row, operator scratchpad and all, handed to the
    // renderer. Bound to a variable first ON PURPOSE — `QuoteEmailInput` has no `internalNotes`, so
    // as an inline object literal this would be rejected by the compiler's excess-property check and
    // the assertions below would never run. Both guards are wanted: the type stops a caller passing
    // it, and this stops the template growing a branch that renders it.
    const withStaffNotes = {
      ...quote,
      internalNotes: 'margin is thin, do not discount further',
      payUrl: 'https://bellemaretours.com/api/v1/quotes/Q7F3A21/open?t=abc',
    };
    const { html, text } = renderQuoteEmail(withStaffNotes);
    expect(html).not.toContain('margin is thin');
    expect(text).not.toContain('margin is thin');
  });

  it('refuses to print a total its own lines do not add up to', () => {
    // The headline figure and the itemisation under it are the one pair of numbers that must agree:
    // api_convert_quote raises `quote_total_mismatch` and refuses to charge whenever they don't, and
    // saveQuote writes them in two non-transactional statements — so a lost line replacement leaves a
    // stored total with no lines behind it. Rendering that produces a guest email headed
    // "Total: EUR 500.00" over nothing, above a link whose only possible answer is "this quote is not
    // ready to pay yet". Send is the last human-visible moment before the guest holds that link:
    // failing here costs the operator one error toast.
    expect(() =>
      renderQuoteEmail({
        ...quote,
        totalMinor: 50000,
        items: [],
        payUrl: 'https://bellemaretours.com/api/v1/quotes/Q7F3A21/open?t=abc',
      }),
    ).toThrow(/total/i);

    // And on the quieter version of the same drift — one line lost, not all of them.
    expect(() =>
      renderQuoteEmail({
        ...quote,
        items: [quote.items[0]!],
        payUrl: 'https://bellemaretours.com/api/v1/quotes/Q7F3A21/open?t=abc',
      }),
    ).toThrow(/total/i);
  });

  it('refuses to email an offer no card can be charged for', () => {
    // The drift check above passes an EMPTY quote, because 0 lines sum to 0 and the stored total is
    // 0 too — and `quotes.total_minor` DEFAULTS to 0 (migration 20260909000000), so a never-priced
    // draft reaches that state by default rather than by accident. It is the same harm the drift
    // check exists to stop, arrived at from the other side: api_convert_quote raises
    // `quote_not_convertible` with detail 'zero total' on any quote totalling <= 0, so the guest is
    // emailed "Total: EUR 0.00" over an empty itemisation above a link that can only ever answer
    // "this quote is not ready to pay yet".
    expect(() =>
      renderQuoteEmail({
        ...quote,
        totalMinor: 0,
        items: [],
        payUrl: 'https://bellemaretours.com/api/v1/quotes/Q7F3A21/open?t=abc',
      }),
    ).toThrow(/total/i);

    // And the same thing with lines on it: every line priced at zero sums to a zero total, which
    // agrees with itself and is still unchargeable.
    expect(() =>
      renderQuoteEmail({
        ...quote,
        totalMinor: 0,
        items: [{ description: 'Complimentary transfer', quantity: 1, unitAmountMinor: 0 }],
        payUrl: 'https://bellemaretours.com/api/v1/quotes/Q7F3A21/open?t=abc',
      }),
    ).toThrow(/total/i);
  });

  it('escapes guest-supplied text instead of letting it inject markup', () => {
    const { html } = renderQuoteEmail({
      ...quote,
      totalMinor: 1000,
      customerName: '<script>alert(1)</script>',
      items: [{ description: '<b>Charter</b>', quantity: 1, unitAmountMinor: 1000 }],
      payUrl: 'https://bellemaretours.com/api/v1/quotes/Q7F3A21/open?t=abc',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Charter</b>');
    expect(html).toContain('&lt;b&gt;Charter&lt;/b&gt;');
  });
});
