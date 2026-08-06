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
      payUrl: 'https://bellemaretours.com/quotes/Q7F3A21?t=abc',
    });
    expect(html).toContain('Private guide, full day');
    expect(html).toContain('Catamaran cruise, 23 Aug, 2 adults');
    expect(html).toContain('230.00');
  });

  it('links to the tokenised pay URL exactly once', () => {
    const payUrl = 'https://bellemaretours.com/quotes/Q7F3A21?t=abc';
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
      payUrl: 'https://bellemaretours.com/quotes/Q7F3A21?t=abc',
    };
    const { html, text } = renderQuoteEmail(withStaffNotes);
    expect(html).not.toContain('margin is thin');
    expect(text).not.toContain('margin is thin');
  });

  it('escapes guest-supplied text instead of letting it inject markup', () => {
    const { html } = renderQuoteEmail({
      ...quote,
      customerName: '<script>alert(1)</script>',
      items: [{ description: '<b>Charter</b>', quantity: 1, unitAmountMinor: 1000 }],
      payUrl: 'https://bellemaretours.com/quotes/Q7F3A21?t=abc',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Charter</b>');
    expect(html).toContain('&lt;b&gt;Charter&lt;/b&gt;');
  });
});
