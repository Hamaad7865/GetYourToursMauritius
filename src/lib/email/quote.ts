import { escapeHtml } from './booking-confirmation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/translate';
import {
  balanceMinorOf,
  depositMinorOf,
  depositPercentLabel,
  isPayInFull,
} from '@/lib/quotes/deposit';
import {
  quoteBalanceOpenPath,
  quoteOpenPath,
  quoteRefLooksValid,
  quoteTokenLooksValid,
} from '@/lib/quotes/link-cookie';
import { lineSubtotalMinor, quoteTotalMinor } from '@/lib/quotes/totals';
import { SITE } from '@/lib/seo/site';
import { ValidationError } from '@/lib/services/errors';

/**
 * The guest-facing quote email: the offer the operator drafted in /admin/quotes, itemised, with the
 * tokenised link that lets the guest pay it without an account.
 *
 * EMAIL-SAFE by construction, exactly as booking-confirmation.ts is: inline `style=""` only (no
 * <style> block, no external CSS, no JS), tables for layout, ~600px width, an absolute PNG logo —
 * the combination that renders across mail clients. Every interpolated value goes through
 * {@link escapeHtml}, because the guest's name, the intro note and every line description are free
 * text an operator typed into a form.
 *
 * Pure: no I/O, no Date.now()/new Date(). Every figure comes from the caller.
 *
 * PRIVACY — the reason the input type is what it is. `internal_notes` lives on the same `quotes` row
 * as the guest's name and total ("margin is thin, don't discount further"), and the send route holds
 * the whole row. This module's input therefore names ONLY guest-facing fields, and no branch of the
 * template reads a note of any kind other than `introNote`, which is the one the operator wrote FOR
 * the guest. Nothing here filters internal notes out — they never arrive.
 *
 * LOCALISED from `quotes.locale`, the same way booking-confirmation.ts is from `bookings.locale`:
 * `translate(locale, …)` against the English source string, never a React `t()` (this renders from a
 * route handler with no request locale of its own, and the language that matters is the QUOTE's, not
 * the operator's). api_convert_quote copies the column into `bookings.locale`, so this email, the
 * confirmation and the VAT invoice are all one language — the one the operator drafted the offer in.
 *
 * The ref, the money, the validity date and the link are NEVER translated or reformatted: they are
 * data, and the invoice module makes the same distinction.
 */

/** Brand accent (teal) — the same palette booking-confirmation.ts uses. */
const ACCENT = '#0E8C92';
const INK = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

/** One priced line of the offer, already described in the words the guest should read. */
export interface QuoteEmailLine {
  /** What the guest is buying. A catalogue line arrives pre-composed ("Catamaran cruise, 23 Aug, 2 adults"). */
  description: string;
  quantity: number;
  unitAmountMinor: number;
}

/** Only what the guest may see. See the PRIVACY note above before adding a field. */
export interface QuoteEmailInput {
  ref: string;
  customerName: string;
  currency: string;
  /** The stored `quotes.total_minor` — the figure the card is charged. See {@link renderQuoteEmail}. */
  totalMinor: number;
  /** A calendar day, `yyyy-mm-dd`, never an instant. */
  validUntil: string;
  /** The operator's covering note TO the guest. Optional; the internal one is a different column. */
  introNote?: string | null;
  /**
   * The stored `quotes.locale` — the language the offer was drafted in, and the one api_convert_quote
   * copies into `bookings.locale` for the confirmation email and the VAT invoice.
   *
   * REQUIRED, though it is typed loosely enough to take the column straight off a PostgREST row
   * (`content_locale` arrives as a plain string, and a row this renderer did not select it on arrives
   * as null/undefined). Required because the harm it prevents is silent: an optional field that a
   * caller forgets emails a French guest an English offer and then, one payment later, French
   * paperwork about it — and nothing anywhere fails. Anything that is not a known {@link Locale}
   * falls back to English rather than rendering raw keys.
   */
  locale: Locale | string | null | undefined;
  /**
   * The stored `quotes.deposit_bps` — the share of the total that CONFIRMS the booking, in basis
   * points (1000 = 10%, the schema default; 10000 = pay-in-full).
   *
   * REQUIRED, for the reason {@link locale} is: what it prevents is silent. api_convert_quote charges
   * `round(total × bps / 10000)` at the card form, so an email that omits it shows a guest "EUR
   * 626.00" and a Pay button, and asks them for EUR 62.60 two clicks later — with the remaining EUR
   * 563.40 never mentioned as owed at all. Nothing fails; the guest simply is not told the terms of
   * the offer they are being asked to accept. A caller that forgets this field now fails to compile.
   */
  depositBps: number;
  items: QuoteEmailLine[];
  /**
   * The RAW link token — 32 bytes of lowercase hex from {@link import('@/lib/quotes/token').mintQuoteToken}
   * — and deliberately NOT a URL.
   *
   * The link this email carries has one legal shape, `/api/v1/quotes/{ref}/open?t=…`, and never
   * `/quotes/{ref}?t=…`: an emailed link cannot be recalled, and a token in a RENDERED page's URL is
   * exported verbatim by two things that run on every customer page — GTM's `page_location` (its tags
   * fall back to cookieless pings even when consent is denied) and src/lib/client-error-report.ts,
   * which writes `window.location.href` into `error_logs` for staff to read for 30 days. The open
   * route renders no HTML, loads no GTM, and moves the token into an httpOnly cookie before
   * redirecting to the clean page (src/lib/quotes/link-cookie.ts).
   *
   * So the caller hands over the token and {@link renderQuoteEmail} builds the URL. A `payUrl: string`
   * field made that a contract in a doc comment, which nothing can fail; this makes the wrong shape
   * unrepresentable.
   */
  linkToken: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Format a MINOR-unit amount as plain `{currency} {amount}` (e.g. "EUR 230.00").
 *
 * booking-confirmation.ts's `money()` takes major units because an InvoiceModel is already in them;
 * a quote is minor units end to end (src/lib/admin/quotes.ts never divides), so the divide happens
 * here, at the last possible moment, and only for display.
 */
function money(currency: string, minorAmount: number): string {
  return `${currency} ${(minorAmount / 100).toFixed(2)}`;
}

/** `2 × EUR 55.00` under the description — but only when there is more than one, so the common
 *  single-unit line stays uncluttered. */
function quantityNote(currency: string, line: QuoteEmailLine): string {
  return line.quantity > 1 ? `${line.quantity} × ${money(currency, line.unitAmountMinor)}` : '';
}

/**
 * Render the quote email — or REFUSE to, when the offer is one api_convert_quote could not charge.
 *
 * The TOTAL printed is the caller's `totalMinor`, not a re-sum of `items`: that is the stored
 * `quotes.total_minor`, the figure copied into `bookings.total_minor` at conversion and charged to
 * the card, so it is the honest one to print. Re-summing instead would produce an email quoting a
 * number no code path can take money for.
 *
 * Two ways that figure can be unchargeable, and the guard below covers both, because they are the
 * same harm reached from opposite sides — a guest emailed a priced offer above a link whose only
 * possible answer is "this quote is not ready to pay yet":
 *
 *  - it DRIFTS from the lines. api_convert_quote raises `quote_total_mismatch` and refuses to charge
 *    on any disagreement, and saveQuote writes the total and the lines in two non-transactional
 *    PostgREST statements whose failure mode it documents itself (a stale occurrence id raises 23503
 *    on the re-insert AFTER the new total is written and the old lines are deleted). An operator who
 *    missed that error and hit Send emails "Total: EUR 500.00" over an empty itemisation.
 *  - it is ZERO. api_convert_quote raises `quote_not_convertible` with detail 'zero total' on any
 *    quote totalling <= 0, because such a booking can never confirm (api_create_payment skips the FX
 *    pin and append_payment_event refuses to read 0 >= 0 as fully paid) and would sit in
 *    payment_pending until the sweep expired it. `quotes.total_minor` DEFAULTS to 0, so an empty or
 *    never-priced draft is in that state by default rather than by accident — and a drift check
 *    alone waves it through, since no lines sum to exactly the zero stored beside them. Same for a
 *    quote whose every line is priced at nothing.
 *
 * Send is the last human-visible moment before the guest holds that link: failing here costs the
 * operator one error toast and a re-save; failing later costs a guest a dead offer and a support
 * ticket.
 *
 * THE THIRD REFUSAL IS THE CALLER'S, and for the same reason this function is pure: an offer whose
 * `valid_until` has already gone by is unchargeable too (api_convert_quote raises `quote_expired`,
 * and the public page will not even open), but deciding that needs today's date, and taking a clock
 * in here would make every rendered email depend on one. So the send path calls
 * `assertQuoteStillValid` (src/lib/quotes/validity.ts) on the STORED `valid_until` immediately
 * before calling this — a quote drafted on Friday and sent on Monday passed saveQuote's identical
 * check and is dead by the time the email goes out.
 */
export function renderQuoteEmail(input: QuoteEmailInput): RenderedEmail {
  // Normalised ONCE, exactly as buildInvoiceModel does it: everything below calls `t()` without
  // re-guarding, and an enum value whose messages do not exist yet renders English instead of keys.
  const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const operator = SITE.operator;
  const ref = input.ref;
  const currency = input.currency;
  const linesMinor = quoteTotalMinor(input.items);
  if (linesMinor !== input.totalMinor || input.totalMinor <= 0) {
    throw new ValidationError(
      `Quote ${ref} cannot be emailed: its lines add up to ${linesMinor} and its stored total is ` +
        `${input.totalMinor}. Save the quote again with a priced line on it before sending it — as ` +
        `it stands, api_convert_quote would refuse to charge it (quote_total_mismatch on a total ` +
        `its lines do not support; quote_not_convertible, 'zero total', on a quote with no priced ` +
        `lines at all).`,
    );
  }
  // THE LINK, built here rather than accepted from the caller — see `linkToken` above. A malformed
  // ref or token cannot open anything (the open route validates the ref before writing it into a
  // cookie Path, and resolveQuoteForToken refuses any token that is not a possible SHA-256 pre-image),
  // so it would email a live-looking offer behind a dead link the guest cannot distinguish from a
  // withdrawn one. Refuse at send, the same as an unchargeable total.
  if (!quoteRefLooksValid(ref) || !quoteTokenLooksValid(input.linkToken)) {
    throw new ValidationError(
      `Quote ${ref} cannot be emailed: its link ref/token is not a shape the open route accepts ` +
        `(ref must be 1-32 alphanumerics; the token must be 64 lowercase hex characters, exactly ` +
        `what mintQuoteToken() produces). The guest would receive a link that can only ever 404.`,
    );
  }
  const payUrl = `${SITE.url}${quoteOpenPath(ref, input.linkToken)}`;
  const totalStr = money(currency, input.totalMinor);

  /* WHAT IS DUE NOW, and what is left. Both figures come from the shared deposit module, which is
   * what api_convert_quote sizes the first charge with — so the sentence below cannot promise a
   * figure the card is not charged. A pay-in-full quote says so in one line and mentions no balance
   * at all: "balance: EUR 0.00" would describe a second payment that never comes. */
  const payInFull = isPayInFull(input.depositBps);
  const depositStr = money(currency, depositMinorOf(input.totalMinor, input.depositBps));
  const balanceStr = money(currency, balanceMinorOf(input.totalMinor, input.depositBps));
  const termsHeading = payInFull ? t('Payment') : t('Deposit to confirm');
  const termsDue = payInFull
    ? t('Pay {total} to confirm your booking.', { total: totalStr })
    : t('Pay {deposit} now to confirm ({percent} of the total).', {
        deposit: depositStr,
        percent: depositPercentLabel(input.depositBps),
      });
  const termsBalance = payInFull
    ? ''
    : t('The balance of {balance} is payable later.', { balance: balanceStr });
  const introNote = input.introNote?.trim() || '';
  const supportEmail = escapeHtml(SITE.email);
  const supportPhone = escapeHtml(SITE.phone);

  const subject = t('Your {operator} quote {ref}', { operator, ref });

  // ── HTML ──────────────────────────────────────────────────────────────────
  // Each line's figure comes from `lineSubtotalMinor`, not from a second `quantity × unit` written
  // out here: that is the function `saveQuote` stores `quote_items.subtotal_minor` with, and the one
  // `quoteTotalMinor` sums into the total printed below — so the emailed lines and the emailed total
  // cannot be arrived at two different ways. It throws on money that is not whole, which the int/
  // bigint columns already make unreachable and which fails the right way anyway: an operator seeing
  // the send fail beats a guest reading a silently rounded figure.
  const lineRows = input.items
    .map((line) => {
      const note = quantityNote(currency, line);
      const desc =
        escapeHtml(line.description) +
        (note
          ? `<div style="margin-top:2px;color:${MUTED};font-size:12.5px;">${escapeHtml(note)}</div>`
          : '');
      const amount = escapeHtml(money(currency, lineSubtotalMinor(line)));
      return `
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid ${BORDER};color:${INK};font-size:14px;">${desc}</td>
              <td style="padding:8px 0;border-bottom:1px solid ${BORDER};color:${INK};font-size:14px;text-align:right;white-space:nowrap;vertical-align:top;">${amount}</td>
            </tr>`;
    })
    .join('');

  const introHtml = introNote
    ? `
              <p style="margin:0 0 20px 0;color:${INK};font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(introNote)}</p>`
    : '';

  /* The header is the same brand-mark partial as the confirmation email: an absolute PNG on white,
   * with the teal reduced to a rule above it, and the operator's NAME as the alt text because most
   * clients block remote images until the reader allows them. See booking-confirmation.ts for the
   * full reasoning — including why the logo is never filtered white. */
  const html = `<!-- ${escapeHtml(operator)} quote ${escapeHtml(ref)} -->
<div style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <!-- header -->
          <tr>
            <td style="background:${ACCENT};font-size:0;line-height:0;height:4px;">&nbsp;</td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:22px 28px 18px;border-bottom:1px solid ${BORDER};">
              <a href="${SITE.url}" style="text-decoration:none;color:${INK};font-size:18px;font-weight:bold;">
                <img src="${SITE.url}/logo.png" width="170" alt="${escapeHtml(operator)}"
                     style="display:block;border:0;width:170px;max-width:170px;height:auto;" />
              </a>
            </td>
          </tr>
          <!-- body -->
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">${escapeHtml(t('Your quote {ref}', { ref }))}</h1>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;line-height:1.5;">
                ${escapeHtml(t('Hi {name}, here is the quote you asked us for.', { name: input.customerName }))}
              </p>
${introHtml}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px 0;">
                ${lineRows}
                <tr>
                  <td style="padding:12px 0 0 0;color:${INK};font-size:15px;font-weight:bold;">${escapeHtml(t('Total'))}</td>
                  <td style="padding:12px 0 0 0;color:${INK};font-size:15px;font-weight:bold;text-align:right;white-space:nowrap;">${escapeHtml(totalStr)}</td>
                </tr>
              </table>
              <p style="margin:4px 0 20px 0;color:${MUTED};font-size:12px;">${escapeHtml(
                t('Valid until {date}. Nothing is reserved until the quote is paid.', {
                  date: input.validUntil,
                }),
              )}</p>

              <!-- Payment terms: the figure the card is actually charged, above the button that
                   charges it. -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;">
                <tr>
                  <td style="background:#f0fafa;border:1px solid #cfe9ea;border-radius:6px;padding:14px 16px;">
                    <div style="color:${MUTED};font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(termsHeading)}</div>
                    <div style="margin-top:4px;color:${INK};font-size:15px;font-weight:bold;">${escapeHtml(termsDue)}</div>
                    ${
                      termsBalance
                        ? `<div style="margin-top:3px;color:${MUTED};font-size:13px;">${escapeHtml(termsBalance)}</div>`
                        : ''
                    }
                  </td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;">
                <tr>
                  <td style="border-radius:6px;background:${ACCENT};">
                    <a href="${escapeHtml(payUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:6px;">${escapeHtml(t('View & pay your quote'))}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:12.5px;line-height:1.5;word-break:break-all;">
                ${escapeHtml(t('Or open this link:'))} ${escapeHtml(payUrl)}
              </p>

              <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.6;">
                ${t(
                  'Something to change? Reply to this email, or contact us at {emailLink} or {phone}.',
                  {
                    // The one interpolation that is deliberately NOT escaped, exactly as
                    // booking-confirmation.ts does it: the value is markup this module composed, and
                    // both halves of it are escaped above.
                    emailLink: `<a href="mailto:${supportEmail}" style="color:${ACCENT};">${supportEmail}</a>`,
                    phone: supportPhone,
                  },
                )}
              </p>
            </td>
          </tr>
          <!-- footer -->
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
              ${escapeHtml(operator)} &middot; ${supportEmail} &middot; ${supportPhone}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;

  // ── Plain-text fallback (same content, same order — the two must not drift) ──
  const textLines = [t('Hi {name},', { name: input.customerName }), ''];
  textLines.push(t('Here is the quote you asked us for ({ref}).', { ref }));
  if (introNote) {
    textLines.push('', introNote);
  }
  textLines.push('');
  for (const line of input.items) {
    const note = quantityNote(currency, line);
    textLines.push(
      `  - ${line.description}${note ? ` (${note})` : ''}: ${money(currency, lineSubtotalMinor(line))}`,
    );
  }
  textLines.push('');
  textLines.push(`${t('Total')}: ${totalStr}`);
  textLines.push(
    t('Valid until {date}. Nothing is reserved until the quote is paid.', {
      date: input.validUntil,
    }),
  );
  // Same terms, same order as the HTML — the two parts are one message and must not drift.
  textLines.push('');
  textLines.push(`${termsHeading}: ${termsDue}`);
  if (termsBalance) textLines.push(termsBalance);
  textLines.push('');
  textLines.push(t('View and pay your quote:'));
  textLines.push(payUrl);
  textLines.push('');
  textLines.push(
    t('Something to change? Reply to this email, or contact us at {emailLink} or {phone}.', {
      emailLink: SITE.email,
      phone: SITE.phone,
    }),
  );
  textLines.push('');
  textLines.push(operator);

  const text = textLines.join('\n');

  return { subject, html, text };
}

/** What the guest owes, and the durable link that collects it. See {@link renderQuoteBalanceEmail}. */
export interface QuoteBalanceEmailInput {
  ref: string;
  customerName: string;
  currency: string;
  /** MINOR units — `bookings.balance_due_minor`, the figure the balance checkout will charge. */
  balanceDueMinor: number;
  /** The quote's own locale, exactly as {@link QuoteEmailInput.locale}. */
  locale: Locale | string | null | undefined;
  /** The RAW balance-link token, and NOT a URL — see below. */
  linkToken: string;
}

/**
 * The BALANCE email: the second half of the money on a quote, and the link that collects it.
 *
 * The deposit confirmed the booking and reserved the seat; this chases what is left. It exists so
 * that "Send balance link" DELIVERS the link rather than only minting one for the operator to paste
 * somewhere by hand — the same shape as sending the quote itself.
 *
 * THE LINK IS BUILT HERE, from the raw token, and it is the /api/ OPEN route
 * (`/api/v1/quotes/{ref}/balance/open?t=…`) — never `/quotes/{ref}/balance?t=…`, which is the
 * OPERATOR's copy-button URL. A raw token in a rendered page's URL is exported verbatim by GTM's
 * `page_location` and by client-error-report.ts into `error_logs`; the open route renders no HTML,
 * loads no tags, and moves the token into an httpOnly cookie before redirecting to the clean page.
 * Accepting a `payUrl: string` would leave that as a contract only a doc comment could state.
 *
 * It REFUSES a non-positive balance and a malformed ref/token, for the same reason
 * {@link renderQuoteEmail} refuses an unchargeable total: create_payment's balance branch rejects a
 * charge of nothing, and a dead link is indistinguishable to the guest from a withdrawn one. Both
 * are cheaper to catch here than after an email has gone out, because an email cannot be recalled.
 *
 * Pure, like every other renderer in this directory: no I/O, no clock.
 */
export function renderQuoteBalanceEmail(input: QuoteBalanceEmailInput): RenderedEmail {
  const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const operator = SITE.operator;
  const ref = input.ref;

  if (!Number.isSafeInteger(input.balanceDueMinor) || input.balanceDueMinor <= 0) {
    throw new ValidationError(
      `Quote ${ref} has no balance to collect (${input.balanceDueMinor} minor units), so there is ` +
        `nothing to email a payment link for. create_payment's balance branch refuses a charge of ` +
        `nothing, so the guest would be sent to a page that can only refuse them.`,
    );
  }
  if (!quoteRefLooksValid(ref) || !quoteTokenLooksValid(input.linkToken)) {
    throw new ValidationError(
      `Quote ${ref} cannot be emailed a balance link: its ref/token is not a shape the balance open ` +
        `route accepts (ref must be 1-32 alphanumerics; the token must be 64 lowercase hex ` +
        `characters). The guest would receive a link that can only ever 404.`,
    );
  }

  const payUrl = `${SITE.url}${quoteBalanceOpenPath(ref, input.linkToken)}`;
  const amount = money(input.currency, input.balanceDueMinor);
  const supportEmail = escapeHtml(SITE.email);
  const supportPhone = escapeHtml(SITE.phone);
  const subject = t('The balance on your {operator} booking {ref}', { operator, ref });

  const html = `<!-- ${escapeHtml(operator)} balance ${escapeHtml(ref)} -->
<div style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <tr><td style="background:${ACCENT};font-size:0;line-height:0;height:4px;">&nbsp;</td></tr>
          <tr>
            <td style="background:#ffffff;padding:22px 28px 18px;border-bottom:1px solid ${BORDER};">
              <a href="${SITE.url}" style="text-decoration:none;color:${INK};font-size:18px;font-weight:bold;">
                <img src="${SITE.url}/logo.png" width="170" alt="${escapeHtml(operator)}"
                     style="display:block;border:0;width:170px;max-width:170px;height:auto;" />
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">${escapeHtml(t('The balance on your booking'))}</h1>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;line-height:1.5;">
                ${escapeHtml(
                  t(
                    'Hi {name}, your deposit is paid and your booking is confirmed. Here is what is left to settle.',
                    { name: input.customerName },
                  ),
                )}
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;">
                <tr>
                  <td style="background:#f0fafa;border:1px solid #cfe9ea;border-radius:6px;padding:14px 16px;">
                    <div style="color:${MUTED};font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(t('Balance due'))}</div>
                    <div style="margin-top:4px;color:${INK};font-size:20px;font-weight:bold;">${escapeHtml(amount)}</div>
                    <div style="margin-top:3px;color:${MUTED};font-size:13px;">${escapeHtml(t('Quote {ref}', { ref }))}</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;">
                <tr>
                  <td style="border-radius:6px;background:${ACCENT};">
                    <a href="${escapeHtml(payUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:6px;">${escapeHtml(t('Pay the balance'))}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:12.5px;line-height:1.5;word-break:break-all;">
                ${escapeHtml(t('Or open this link:'))} ${escapeHtml(payUrl)}
              </p>

              <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.6;">
                ${t(
                  'Something to change? Reply to this email, or contact us at {emailLink} or {phone}.',
                  {
                    emailLink: `<a href="mailto:${supportEmail}" style="color:${ACCENT};">${supportEmail}</a>`,
                    phone: supportPhone,
                  },
                )}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
              ${escapeHtml(operator)} &middot; ${supportEmail} &middot; ${supportPhone}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;

  const text = [
    t('Hi {name},', { name: input.customerName }),
    '',
    t('Your deposit is paid and your booking is confirmed. Here is what is left to settle.'),
    '',
    `${t('Balance due')}: ${amount} (${t('Quote {ref}', { ref })})`,
    '',
    t('Pay the balance:'),
    payUrl,
    '',
    t('Something to change? Reply to this email, or contact us at {emailLink} or {phone}.', {
      emailLink: SITE.email,
      phone: SITE.phone,
    }),
    '',
    operator,
  ].join('\n');

  return { subject, html, text };
}
