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
  /** 10% — the schema default, and the figure the guest's card is actually charged to confirm. */
  depositBps: 1000,
  items: [
    { description: 'Catamaran cruise, 23 Aug, 2 adults', quantity: 2, unitAmountMinor: 5500 },
    { description: 'Private guide, full day', quantity: 1, unitAmountMinor: 12000 },
  ],
};

const OPEN_URL = `${SITE.url}/api/v1/quotes/Q7F3A21/open?t=${TOKEN}`;

/**
 * WHAT THE GUEST ACTUALLY PAYS NOW.
 *
 * api_convert_quote sizes the first charge from `quotes.deposit_bps` — `round(total × bps / 10000)` —
 * so a 10% quote for EUR 230.00 takes EUR 23.00 at the card form and leaves EUR 207.00 owed. The email
 * printed the TOTAL and a "pay your quote" button and said nothing about either figure, which is the
 * one number a guest reads a quote to find. An offer that hides its payment terms is not an offer;
 * the operator's own emails have always spelled out "10% to confirm, balance later" by hand.
 *
 * The deposit is never re-derived here from a percentage the template invents: it comes from
 * `depositMinorOf`, the single definition the editor previews and the conversion RPC both size from.
 */
describe('the deposit that confirms the booking', () => {
  it('states what is due now and what is left, beside the total', () => {
    const { html, text } = renderQuoteEmail(quote);
    // 10% of EUR 230.00. Asserted with the currency prefix so it cannot accidentally match inside
    // the total ("EUR 230.00" does not contain "EUR 23.00").
    expect(html).toContain('EUR 23.00');
    expect(html).toContain('EUR 207.00');
    // The plain-text part must not drift from the HTML — the two are the same message.
    expect(text).toContain('EUR 23.00');
    expect(text).toContain('EUR 207.00');
  });

  it('names the percentage, so the terms are not just a bare figure', () => {
    expect(renderQuoteEmail(quote).html).toContain('10%');
  });

  it('sizes the deposit exactly as the conversion RPC does, rounding included', () => {
    // 3.33% of EUR 230.00 = 765.9 minor units. api_convert_quote stores round(...) = 766, so the
    // guest must be told EUR 7.66 — a template doing its own floor/ceil would quote a figure the
    // card is never charged.
    const { html } = renderQuoteEmail({ ...quote, depositBps: 333 });
    expect(html).toContain('EUR 7.66');
    expect(html).toContain(`EUR ${((23000 - 766) / 100).toFixed(2)}`);
  });

  it('promises no balance when the guest is paying in full', () => {
    // 10000 bps = the whole total; there is nothing left to collect, so a "balance: EUR 0.00" line
    // would be a lie about a second payment that never comes.
    const { html, text } = renderQuoteEmail({ ...quote, depositBps: 10000 });
    expect(html).not.toMatch(/balance/i);
    expect(text).not.toMatch(/balance/i);
    expect(html).not.toContain('EUR 0.00');
  });

  it('says it in the language the offer was drafted in', () => {
    // The quote's own locale picks the confirmation email and the VAT invoice too; the sentence that
    // states the payment terms cannot be the one that reverts to English.
    const { html } = renderQuoteEmail({ ...quote, locale: 'fr' });
    expect(html).toContain('EUR 23.00');
    expect(html).toMatch(/acompte/i);
    expect(html).not.toMatch(/Deposit to confirm/i);
  });
});

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

/**
 * A PER-DATE quote is disclosed as a SCHEDULE, not a % deposit.
 *
 * api_convert_quote overrides the deposit to the FIRST activity date's sum (not total × deposit_bps),
 * so the "pay now" the email states must be that figure — the exact amount the card is charged — and
 * name the later dates, never "10% now, balance later". The adversarial review caught the email stating
 * the % deposit for a per_date quote: the guest was shown EUR 100 and charged EUR 400.
 */
describe('a per_date quote states its schedule, not the % deposit', () => {
  const perDate = {
    ...quote,
    totalMinor: 100000, // EUR 1000.00
    depositBps: 1000, // 10% — deliberately, to prove the schedule OVERRIDES it
    paymentMode: 'per_date' as const,
    schedule: [
      { seq: 0, dueOn: '2026-09-05', amountMinor: 40000 }, // EUR 400 due now (first date's sum)
      { seq: 1, dueOn: '2026-09-08', amountMinor: 35000 }, // EUR 350
      { seq: 2, dueOn: '2026-09-11', amountMinor: 25000 }, // EUR 250
    ],
    items: [{ description: 'Trip', quantity: 1, unitAmountMinor: 100000 }],
  };

  it('shows the first date sum as due now, never the 10% deposit', () => {
    const { html, text } = renderQuoteEmail(perDate);
    expect(html).toContain('EUR 400.00'); // first date's sum — what the card is charged
    expect(text).toContain('EUR 400.00');
    // The 10% figure (EUR 100.00) must NOT appear, and never the deposit "% of the total" sentence.
    expect(html).not.toContain('EUR 100.00');
    expect(html).not.toContain('of the total');
  });

  it('names the later dates and their amounts', () => {
    const { html, text } = renderQuoteEmail(perDate);
    for (const part of [html, text]) {
      expect(part).toContain('EUR 350.00');
      expect(part).toContain('EUR 250.00');
      expect(part).toContain('8 Sep 2026');
      expect(part).toContain('11 Sep 2026');
    }
  });

  it('a single-date per_date quote reads as pay-in-full-that-date', () => {
    const single = {
      ...perDate,
      totalMinor: 40000,
      schedule: [{ seq: 0, dueOn: '2026-09-05', amountMinor: 40000 }],
      items: [{ description: 'Trip', quantity: 1, unitAmountMinor: 40000 }],
    };
    const { html } = renderQuoteEmail(single);
    expect(html).toContain('EUR 400.00 to confirm');
    expect(html).not.toContain('of the total');
  });

  it('a per_date quote with NO dated line falls back to the % deposit, as the RPC does', () => {
    const undated = { ...perDate, schedule: [] };
    const { html } = renderQuoteEmail(undated);
    // Empty schedule → deposit terms: 10% of EUR 1000.00 = EUR 100.00, "of the total".
    expect(html).toContain('EUR 100.00');
    expect(html).toContain('of the total');
  });
});

/**
 * A line carrying a round-trip TRANSFER add-on. `quotes.total_minor` is Σ(subtotal+transport), so the
 * transfer fare must be threaded onto the email line or the renderer's reconciliation guard (lines add
 * up to the stored total) throws and refuses to email ANY quote with a transfer. This pins that the fare
 * reconciles and is itemised.
 */
describe('a line with a round-trip transfer add-on', () => {
  const withTransfer = {
    ...quote,
    totalMinor: 61600, // EUR 520.00 tour + EUR 96.00 transfer
    items: [
      {
        description: 'Private South tour',
        quantity: 1,
        unitAmountMinor: 52000,
        transportFareMinor: 9600,
      },
    ],
  };

  it('renders instead of throwing — the fare reconciles the lines to the stored total', () => {
    expect(() => renderQuoteEmail(withTransfer)).not.toThrow();
  });

  it('itemises the transfer as a nested add-on in both HTML and text', () => {
    const { html, text } = renderQuoteEmail(withTransfer);
    for (const part of [html, text]) {
      expect(part).toContain('EUR 520.00'); // the tour line
      expect(part).toContain('EUR 96.00'); // the nested transfer
      expect(part).toContain('Round-trip transfer');
      expect(part).toContain('EUR 616.00'); // the total the two add up to
    }
  });

  it('still refuses a total its lines genuinely do not support', () => {
    // The guard must not be blunted: a stored total that exceeds lines+transfer still throws.
    expect(() => renderQuoteEmail({ ...withTransfer, totalMinor: 70000 })).toThrow();
  });
});
