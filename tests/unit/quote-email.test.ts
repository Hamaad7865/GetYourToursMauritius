import { describe, expect, it } from 'vitest';
import { renderQuoteEmail } from '@/lib/email/quote';
import { SITE } from '@/lib/seo/site';

/**
 * The guest-facing quote email. A pure renderer, like every other module in src/lib/email — the
 * offer's own figures in, `{ subject, html, text }` out, no I/O and no clock.
 *
 * The third test is the privacy one, and it is the reason this file exists at all:
 * `quotes.internal_notes` is the operator's margin/negotiation scratchpad, sat on the same row as the
 * guest's name and total, and the send route hands this renderer the whole quote. It must be
 * impossible for that column to reach the message body.
 *
 * The FIRST two are the other thing an email cannot take back: the shape of the link. The module is
 * handed a raw token, not a URL, so no caller can compose `/quotes/{ref}?t=…` — a token in a RENDERED
 * page's URL is exported verbatim by GTM's `page_location` and by src/lib/client-error-report.ts into
 * `error_logs`, and the whole reason `quotes.token_hash` stores only a SHA-256 is that a read of the
 * data should not mint a working link. A doc comment saying "pass the /api/ route" cannot fail a test;
 * this can.
 */
const TOKEN = 'a1b2c3d4'.repeat(8); // 64 lowercase hex, exactly what mintQuoteToken() produces

const quote = {
  ref: 'Q7F3A21',
  customerName: 'Marie Dupont',
  currency: 'EUR',
  totalMinor: 23000,
  validUntil: '2026-08-19',
  introNote: 'As discussed on the phone.',
  locale: 'en',
  linkToken: TOKEN,
  items: [
    { description: 'Catamaran cruise, 23 Aug, 2 adults', quantity: 2, unitAmountMinor: 5500 },
    { description: 'Private guide, full day', quantity: 1, unitAmountMinor: 12000 },
  ],
};

const OPEN_URL = `${SITE.url}/api/v1/quotes/Q7F3A21/open?t=${TOKEN}`;

describe('quote email', () => {
  it('lists every line and the total', () => {
    const { html } = renderQuoteEmail(quote);
    expect(html).toContain('Private guide, full day');
    expect(html).toContain('Catamaran cruise, 23 Aug, 2 adults');
    expect(html).toContain('230.00');
  });

  it('builds the tokenised link itself, and it is the /api/ route', () => {
    const { html, text } = renderQuoteEmail(quote);

    expect(html).toContain(OPEN_URL);
    expect(text).toContain(OPEN_URL);
    // The shape this module exists to make unreachable. A caller cannot produce it, because a caller
    // no longer supplies a URL at all.
    expect(html).not.toContain(`/quotes/${quote.ref}?t=`);
    expect(text).not.toContain(`/quotes/${quote.ref}?t=`);
  });

  it('refuses a token that could never open the link', () => {
    // A truncated or placeholder token emails a live-looking offer behind a dead link — and the guest
    // cannot tell, because the open route fails closed and lands them on the same 404 every other
    // refusal does.
    expect(() => renderQuoteEmail({ ...quote, linkToken: 'abc' })).toThrow(/token/i);
    expect(() => renderQuoteEmail({ ...quote, linkToken: '' })).toThrow(/token/i);
    expect(() => renderQuoteEmail({ ...quote, linkToken: TOKEN.toUpperCase() })).toThrow(/token/i);
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
    expect(() => renderQuoteEmail({ ...quote, totalMinor: 50000, items: [] })).toThrow(/total/i);

    // And on the quieter version of the same drift — one line lost, not all of them.
    expect(() => renderQuoteEmail({ ...quote, items: [quote.items[0]!] })).toThrow(/total/i);
  });

  it('refuses to email an offer no card can be charged for', () => {
    // The drift check above passes an EMPTY quote, because 0 lines sum to 0 and the stored total is
    // 0 too — and `quotes.total_minor` DEFAULTS to 0 (migration 20260909000000), so a never-priced
    // draft reaches that state by default rather than by accident. It is the same harm the drift
    // check exists to stop, arrived at from the other side: api_convert_quote raises
    // `quote_not_convertible` with detail 'zero total' on any quote totalling <= 0, so the guest is
    // emailed "Total: EUR 0.00" over an empty itemisation above a link that can only ever answer
    // "this quote is not ready to pay yet".
    expect(() => renderQuoteEmail({ ...quote, totalMinor: 0, items: [] })).toThrow(/total/i);

    // And the same thing with lines on it: every line priced at zero sums to a zero total, which
    // agrees with itself and is still unchargeable.
    expect(() =>
      renderQuoteEmail({
        ...quote,
        totalMinor: 0,
        items: [{ description: 'Complimentary transfer', quantity: 1, unitAmountMinor: 0 }],
      }),
    ).toThrow(/total/i);
  });

  it('is written in the language the quote was drafted in', () => {
    // `quotes.locale` is `content_locale not null default 'en'`, the operator picks it in the editor,
    // and api_convert_quote copies it into `bookings.locale` — where it already decides the language
    // of the confirmation email and the VAT invoice. This email is the FIRST thing the guest reads,
    // so it must not be the one document in the chain that ignores the column.
    const fr = renderQuoteEmail({ ...quote, locale: 'fr' });
    const en = renderQuoteEmail({ ...quote, locale: 'en' });

    expect(fr.subject).toContain('Votre devis');
    expect(fr.html).toContain('Bonjour Marie Dupont');
    expect(fr.html).toContain('voici le devis que vous nous avez demandé');
    expect(fr.html).toContain('Voir et payer votre devis');
    expect(fr.html).toContain('Valable jusqu’au 2026-08-19');
    expect(fr.text).toContain('Voici le devis que vous nous avez demandé');

    // The other half, and the one a "translate everything" change breaks: an English quote must NOT
    // pick up French copy.
    expect(en.subject).not.toContain('devis');
    expect(en.html).toContain('here is the quote you asked us for');
    expect(en.html).not.toContain('Voici');
    expect(en.text).toContain('Here is the quote you asked us for');

    // Neither language may touch the money, the dates or the link — those are data, not copy.
    expect(fr.html).toContain(OPEN_URL);
    expect(fr.html).toContain('EUR 230.00');
    expect(fr.html).toContain('2026-08-19');
    expect(fr.html).toContain('As discussed on the phone.');
  });

  it('falls back to English for a locale it does not have', () => {
    // The send route reads whatever the column holds. `content_locale` is an enum of exactly en/fr
    // today, so this is the branch that keeps a THIRD value — added to the enum before its messages
    // exist — rendering an English email rather than raw translation keys.
    for (const locale of [null, '', 'de', 'EN']) {
      const mail = renderQuoteEmail({ ...quote, locale });
      expect(mail.html, `locale ${JSON.stringify(locale)} did not fall back`).toContain(
        'here is the quote you asked us for',
      );
    }
  });

  it('escapes guest-supplied text instead of letting it inject markup', () => {
    const { html } = renderQuoteEmail({
      ...quote,
      totalMinor: 1000,
      customerName: '<script>alert(1)</script>',
      items: [{ description: '<b>Charter</b>', quantity: 1, unitAmountMinor: 1000 }],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Charter</b>');
    expect(html).toContain('&lt;b&gt;Charter&lt;/b&gt;');
  });
});
