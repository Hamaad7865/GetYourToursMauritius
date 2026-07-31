import type { InvoiceModel } from '@/lib/invoice/model';
import { formatMauritiusDateTime } from '@/lib/invoice/mauritius-time';
import { translate } from '@/lib/i18n/translate';

/**
 * Branded HTML confirmation email rendered from the pure {@link InvoiceModel}. The invoice/receipt PDF
 * is attached separately (Task 6); this module only renders the message body (subject + html + text).
 *
 * EMAIL-SAFE by construction: inline `style=""` only (no <style> block, no external CSS, no JS), tables
 * for layout, ~600px width — the combination that renders most reliably across mail clients. Every
 * interpolated dynamic value is run through {@link escapeHtml} so a hostile booking field can never
 * inject markup.
 *
 * Pure: no I/O, no Date.now()/new Date(). All figures and timestamps come from the model.
 *
 * Localised (Task 16) via `model.locale` — the guest's language, stored on the booking at checkout,
 * NOT the sender's locale (this renders later from a cron worker with no request/cookie of its own).
 * The booking reference and every money figure/currency are never translated or reformatted.
 */

/** Brand accent (teal). */
const ACCENT = '#0E8C92';
const INK = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

/** Escape the five HTML-significant characters so dynamic values can never break out of text/attributes. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format an EUR major-unit amount as plain `{currency} {amount}` with 2 decimals (e.g. "EUR 191.00"). */
function money(currency: string, amount: number): string {
  return `${currency} ${amount.toFixed(2)}`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderConfirmationEmail(model: InvoiceModel, bookingUrl?: string): RenderedEmail {
  const locale = model.locale;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const operator = model.business.legalName;
  const ref = model.booking.ref;
  const activity = model.booking.activityTitle;
  const when = formatMauritiusDateTime(model.booking.when);
  const totalStr = money(model.currency, model.totalGrossEur);
  const totalHtml = escapeHtml(totalStr);
  // Cross-currency charge (MUR since 2026-07-30): state what the CARD actually paid, right under the
  // EUR total, so the customer's statement line matches something in the email. Rendered only when
  // converted — EUR-era emails are unchanged.
  const chargedStr = model.payment?.isConverted
    ? `${model.payment.chargedCurrency} ${model.payment.chargedAmount.toFixed(2)}`
    : null;
  const chargedRowHtml = chargedStr
    ? `
                <tr>
                  <td style="padding:4px 0 0 0;color:${MUTED};font-size:12.5px;">${escapeHtml(t('Charged to your card'))}</td>
                  <td style="padding:4px 0 0 0;color:${MUTED};font-size:12.5px;text-align:right;white-space:nowrap;">${escapeHtml(chargedStr)}</td>
                </tr>`
    : '';

  const subject = t('Your {operator} booking {ref} — invoice & receipt', { operator, ref });

  // ── HTML ──────────────────────────────────────────────────────────────────
  const lineRows = model.lines
    .map((line) => {
      const desc = escapeHtml(line.description);
      const amount = escapeHtml(money(model.currency, line.lineGrossEur));
      return `
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid ${BORDER};color:${INK};font-size:14px;">${desc}</td>
              <td style="padding:8px 0;border-bottom:1px solid ${BORDER};color:${INK};font-size:14px;text-align:right;white-space:nowrap;">${amount}</td>
            </tr>`;
    })
    .join('');

  const detailRow = (label: string, value: string): string => `
            <tr>
              <td style="padding:4px 0;color:${MUTED};font-size:14px;width:140px;vertical-align:top;">${escapeHtml(label)}</td>
              <td style="padding:4px 0;color:${INK};font-size:14px;">${value}</td>
            </tr>`;

  const tr = model.booking.transfer;
  const transferDirectionLabel = (d?: string | null): string =>
    d === 'departure'
      ? t('Departure (hotel → airport)')
      : d === 'return'
        ? t('Return (both ways)')
        : t('Arrival (airport → hotel)');

  const detailRows = [
    detailRow(t('Booking ref'), `<strong>${escapeHtml(ref)}</strong>`),
    detailRow(t('Activity'), escapeHtml(activity)),
    when ? detailRow(t('Date'), escapeHtml(when)) : '',
    model.booking.pickup ? detailRow(t('Pick-up'), escapeHtml(model.booking.pickup)) : '',
    model.booking.dropoff ? detailRow(t('Drop-off'), escapeHtml(model.booking.dropoff)) : '',
    // Airport-transfer details block — the driver's run-sheet data.
    tr ? detailRow(t('Trip'), escapeHtml(transferDirectionLabel(tr.direction))) : '',
    tr?.roomOrCabin ? detailRow(t('Room/cabin'), escapeHtml(tr.roomOrCabin)) : '',
    tr && (tr.flightNumber || tr.arrivalTime)
      ? detailRow(
          t('Arrival flight'),
          escapeHtml([tr.flightNumber, tr.arrivalTime].filter(Boolean).join(' · ')),
        )
      : '',
    tr && (tr.departureFlightNumber || tr.returnDate || tr.returnTime)
      ? detailRow(
          t('Departure'),
          escapeHtml(
            [tr.departureFlightNumber, [tr.returnDate, tr.returnTime].filter(Boolean).join(' ')]
              .filter(Boolean)
              .join(' · '),
          ),
        )
      : '',
    tr?.luggageDetails ? detailRow(t('Luggage'), escapeHtml(tr.luggageDetails)) : '',
    tr && typeof tr.childSeatAge === 'number'
      ? detailRow(t('Child seat (age)'), escapeHtml(String(tr.childSeatAge)))
      : '',
    tr?.specialNotes ? detailRow(t('Notes'), escapeHtml(tr.specialNotes)) : '',
  ].join('');

  const supportEmail = escapeHtml(model.business.email);
  const supportPhone = escapeHtml(model.business.phone);
  const vatPct = String(model.vatRatePct);

  // Airport-transfer e-voucher: offered as a SECURE LINK to the (auth-gated) booking page, not attached —
  // so mail-scanners have no PDF to false-positive on. A bulletproof, table-wrapped button for client support.
  const voucherHtml =
    tr && bookingUrl
      ? `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;">
                <tr>
                  <td style="border-radius:6px;background:${ACCENT};">
                    <a href="${escapeHtml(bookingUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:6px;">${escapeHtml(t('View & download your e-voucher'))}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 20px 0;color:${INK};font-size:14px;line-height:1.5;">
                ${escapeHtml(
                  t(
                    "Your airport-transfer e-voucher — the one to show your driver — is saved in your booking. Open it on your phone any time; there's no attachment to download from this email.",
                  ),
                )}
              </p>`
      : '';

  const html = `<!-- ${escapeHtml(operator)} booking confirmation -->
<div style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <!-- header -->
          <tr>
            <td style="background:${ACCENT};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;">
              ${escapeHtml(operator)}
            </td>
          </tr>
          <!-- body -->
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">${escapeHtml(t('Your booking is confirmed'))} ✅</h1>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;line-height:1.5;">
                ${escapeHtml(t('Thanks for booking with {operator}. Here are your details.', { operator }))}
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                ${detailRows}
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px 0;">
                ${lineRows}
                <tr>
                  <td style="padding:12px 0 0 0;color:${INK};font-size:15px;font-weight:bold;">${escapeHtml(t('Total'))}</td>
                  <td style="padding:12px 0 0 0;color:${INK};font-size:15px;font-weight:bold;text-align:right;white-space:nowrap;">${totalHtml}</td>
                </tr>
                ${chargedRowHtml}
              </table>
              <p style="margin:4px 0 20px 0;color:${MUTED};font-size:12px;">${escapeHtml(t('(incl. {vatPct}% VAT)', { vatPct }))}</p>
${voucherHtml}
              <p style="margin:0 0 20px 0;color:${INK};font-size:14px;line-height:1.5;">
                ${escapeHtml(t('Your invoice & receipt are attached as a PDF.'))}
              </p>

              <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.6;">
                ${t('Questions? Contact us at {emailLink} or {phone}.', {
                  emailLink: `<a href="mailto:${supportEmail}" style="color:${ACCENT};">${supportEmail}</a>`,
                  phone: supportPhone,
                })}
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

  // ── Plain-text fallback (mirrors the existing resend booking_confirmation tone) ──
  const textLines = [
    t('Hi {name},', { name: model.customer.name }),
    '',
    t('Good news — your booking {ref} is confirmed (total {total}).', { ref, total: totalStr }),
    '',
    `${t('Activity')}: ${activity}`,
  ];
  if (when) textLines.push(`${t('Date')}: ${when}`);
  if (model.booking.pickup) textLines.push(`${t('Pick-up')}: ${model.booking.pickup}`);
  if (model.booking.dropoff) textLines.push(`${t('Drop-off')}: ${model.booking.dropoff}`);
  if (tr) {
    textLines.push(`${t('Trip')}: ${transferDirectionLabel(tr.direction)}`);
    if (tr.roomOrCabin) textLines.push(`${t('Room/cabin')}: ${tr.roomOrCabin}`);
    if (tr.flightNumber || tr.arrivalTime)
      textLines.push(
        `${t('Arrival flight')}: ${[tr.flightNumber, tr.arrivalTime].filter(Boolean).join(' · ')}`,
      );
    if (tr.departureFlightNumber || tr.returnDate || tr.returnTime) {
      textLines.push(
        `${t('Departure')}: ${[tr.departureFlightNumber, [tr.returnDate, tr.returnTime].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}`,
      );
    }
    if (tr.luggageDetails) textLines.push(`${t('Luggage')}: ${tr.luggageDetails}`);
    if (typeof tr.childSeatAge === 'number')
      textLines.push(`${t('Child seat (age)')}: ${tr.childSeatAge}`);
    if (tr.specialNotes) textLines.push(`${t('Notes')}: ${tr.specialNotes}`);
  }
  textLines.push('');
  for (const line of model.lines) {
    textLines.push(`  - ${line.description}: ${money(model.currency, line.lineGrossEur)}`);
  }
  textLines.push('');
  textLines.push(`${t('Total')}: ${totalStr} ${t('(incl. {vatPct}% VAT)', { vatPct })}`);
  if (chargedStr) textLines.push(`${t('Charged to your card')}: ${chargedStr}`);
  textLines.push('');
  if (tr && bookingUrl) {
    textLines.push(
      t('Your airport-transfer e-voucher (show this to your driver) is in your booking:'),
    );
    textLines.push(bookingUrl);
    textLines.push('');
  }
  textLines.push(t('Your invoice & receipt are attached as a PDF.'));
  textLines.push('');
  textLines.push(
    t('Questions? Contact us at {emailLink} or {phone}.', {
      emailLink: model.business.email,
      phone: model.business.phone,
    }),
  );
  textLines.push('');
  textLines.push(operator);

  const text = textLines.join('\n');

  return { subject, html, text };
}
