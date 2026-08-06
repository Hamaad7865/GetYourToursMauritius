import { escapeHtml } from './booking-confirmation';
import { lineSubtotalMinor } from '@/lib/quotes/totals';
import { SITE } from '@/lib/seo/site';

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
 * NOT localised, unlike booking-confirmation.ts and review-request.ts: `quotes.locale` exists and is
 * carried into the booking at conversion, so a French quote still gets a French confirmation and
 * invoice, but the wording below is English only. Translating it is a follow-up, not a formatting
 * detail to improvise here — every string would need its French twin in src/lib/i18n/messages.ts.
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
  items: QuoteEmailLine[];
  /** The public quote page with the raw link token on it — the guest's only way in. */
  payUrl: string;
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
 * Render the quote email.
 *
 * The TOTAL printed is the caller's `totalMinor`, not a re-sum of `items`: that is the stored
 * `quotes.total_minor`, and it is the figure copied into `bookings.total_minor` at conversion and
 * charged to the card. The two cannot disagree in practice — saveQuote derives the stored total from
 * the same lines, and api_convert_quote refuses to charge a quote whose lines no longer sum to it
 * (`quote_total_mismatch`) — so printing the charged figure is the honest one to print. Re-summing
 * here would instead produce an email quoting a number no code path can take money for.
 */
export function renderQuoteEmail(input: QuoteEmailInput): RenderedEmail {
  const operator = SITE.operator;
  const ref = input.ref;
  const currency = input.currency;
  const totalStr = money(currency, input.totalMinor);
  const introNote = input.introNote?.trim() || '';
  const supportEmail = escapeHtml(SITE.email);
  const supportPhone = escapeHtml(SITE.phone);

  const subject = `Your ${operator} quote ${ref}`;

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
              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">Your quote ${escapeHtml(ref)}</h1>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;line-height:1.5;">
                Hi ${escapeHtml(input.customerName)}, here is the quote you asked us for.
              </p>
${introHtml}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px 0;">
                ${lineRows}
                <tr>
                  <td style="padding:12px 0 0 0;color:${INK};font-size:15px;font-weight:bold;">Total</td>
                  <td style="padding:12px 0 0 0;color:${INK};font-size:15px;font-weight:bold;text-align:right;white-space:nowrap;">${escapeHtml(totalStr)}</td>
                </tr>
              </table>
              <p style="margin:4px 0 20px 0;color:${MUTED};font-size:12px;">Valid until ${escapeHtml(input.validUntil)}. Nothing is reserved until the quote is paid.</p>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;">
                <tr>
                  <td style="border-radius:6px;background:${ACCENT};">
                    <a href="${escapeHtml(input.payUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:6px;">View &amp; pay your quote</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:12.5px;line-height:1.5;word-break:break-all;">
                Or open this link: ${escapeHtml(input.payUrl)}
              </p>

              <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.6;">
                Something to change? Reply to this email, or contact us at
                <a href="mailto:${supportEmail}" style="color:${ACCENT};">${supportEmail}</a> or ${supportPhone}.
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
  const textLines = [`Hi ${input.customerName},`, ''];
  textLines.push(`Here is the quote you asked us for (${ref}).`);
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
  textLines.push(`Total: ${totalStr}`);
  textLines.push(`Valid until ${input.validUntil}. Nothing is reserved until the quote is paid.`);
  textLines.push('');
  textLines.push('View and pay your quote:');
  textLines.push(input.payUrl);
  textLines.push('');
  textLines.push(
    `Something to change? Reply to this email, or contact us at ${SITE.email} or ${SITE.phone}.`,
  );
  textLines.push('');
  textLines.push(operator);

  const text = textLines.join('\n');

  return { subject, html, text };
}
