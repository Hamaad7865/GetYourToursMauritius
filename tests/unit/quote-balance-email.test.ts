import { describe, expect, it } from 'vitest';
import { renderQuoteBalanceEmail } from '@/lib/email/quote';
import { SITE } from '@/lib/seo/site';

/**
 * The BALANCE email — the second half of the money on a quote.
 *
 * The deposit confirms the booking and reserves the seat; the balance is chased later. "Send balance
 * link" minted a durable link and handed the OPERATOR a URL to copy into WhatsApp or their own mail
 * client by hand, which is both a chore and a place for the link to go missing. This renders the
 * guest-facing email so the same button that mints the link also delivers it, exactly as sending a
 * quote does.
 *
 * The LINK SHAPE is the whole reason this is a renderer and not a string built at the call site.
 * `/quotes/{ref}/balance?t=…` is the operator's copy-button URL; it must never be the EMAILED one,
 * because a raw token in a rendered page's URL is exported verbatim by GTM's `page_location` and by
 * client-error-report.ts into `error_logs`. The email therefore carries the /api/ open route, which
 * renders no HTML, loads no tags, and moves the token into an httpOnly cookie before redirecting.
 * A doc comment saying so cannot fail; this can.
 */

const TOKEN = 'c3d4e5f6'.repeat(8); // 64 lowercase hex, what mintQuoteToken() produces

const balance = {
  ref: 'Q7F3A21',
  customerName: 'Marie Dupont',
  currency: 'EUR',
  balanceDueMinor: 55440,
  locale: 'en',
  linkToken: TOKEN,
};

const OPEN_URL = `${SITE.url}/api/v1/quotes/Q7F3A21/balance/open?t=${TOKEN}`;

describe('quote balance email', () => {
  it('names the amount still owed', () => {
    const { html, text } = renderQuoteBalanceEmail(balance);
    expect(html).toContain('EUR 554.40');
    expect(text).toContain('EUR 554.40');
  });

  it('links through the open route, never the page URL that would leak the token', () => {
    const { html, text } = renderQuoteBalanceEmail(balance);
    expect(html).toContain(OPEN_URL);
    expect(text).toContain(OPEN_URL);
    // The operator's copy-button shape. Emailing it would put a live bearer token into every GTM
    // page_location ping and any error_logs row the page filed.
    expect(html).not.toContain(`/quotes/${balance.ref}/balance?t=`);
    expect(text).not.toContain(`/quotes/${balance.ref}/balance?t=`);
  });

  it('refuses a token that could never open the link', () => {
    // A truncated or placeholder token emails a live-looking demand behind a dead link, and the guest
    // cannot tell it from a withdrawn one.
    expect(() => renderQuoteBalanceEmail({ ...balance, linkToken: 'abc' })).toThrow(/token/i);
    expect(() => renderQuoteBalanceEmail({ ...balance, linkToken: TOKEN.toUpperCase() })).toThrow(
      /token/i,
    );
  });

  it('refuses to ask for nothing', () => {
    // create_payment's balance branch rejects a non-positive charge, so an email demanding EUR 0.00
    // would send the guest to a page whose only possible answer is a refusal.
    expect(() => renderQuoteBalanceEmail({ ...balance, balanceDueMinor: 0 })).toThrow(/balance/i);
    expect(() => renderQuoteBalanceEmail({ ...balance, balanceDueMinor: -100 })).toThrow(
      /balance/i,
    );
  });

  it('writes in the language the offer was drafted in', () => {
    const { html, subject } = renderQuoteBalanceEmail({ ...balance, locale: 'fr' });
    expect(html).toMatch(/solde/i);
    expect(subject).toMatch(/solde/i);
    // The money is data — never translated or reformatted.
    expect(html).toContain('EUR 554.40');
  });

  it('carries the quote reference in the subject, so a reply can be placed', () => {
    expect(renderQuoteBalanceEmail(balance).subject).toContain('Q7F3A21');
  });
});
