import type { InvoiceModel } from '@/lib/invoice/model';

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

/** Render an ISO timestamp as a stable, locale-independent UTC string. Pure — no `new Date()` math. */
function formatWhen(iso: string): string {
  if (!iso) return '';
  // Keep it deterministic and dependency-free: show the date + HH:MM from the ISO string itself.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, hh, mm] = m;
  return `${y}-${mo}-${d} ${hh}:${mm} UTC`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderConfirmationEmail(model: InvoiceModel): RenderedEmail {
  const operator = model.business.legalName;
  const ref = model.booking.ref;
  const activity = model.booking.activityTitle;
  const when = formatWhen(model.booking.when);
  const totalStr = money(model.currency, model.totalGrossEur);
  const totalHtml = escapeHtml(totalStr);

  const subject = `Your ${operator} booking ${ref} — invoice & receipt`;

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

  const detailRows = [
    detailRow('Booking ref', `<strong>${escapeHtml(ref)}</strong>`),
    detailRow('Activity', escapeHtml(activity)),
    when ? detailRow('Date', escapeHtml(when)) : '',
    model.booking.pickup ? detailRow('Pick-up', escapeHtml(model.booking.pickup)) : '',
    model.booking.dropoff ? detailRow('Drop-off', escapeHtml(model.booking.dropoff)) : '',
  ].join('');

  const supportEmail = escapeHtml(model.business.email);
  const supportPhone = escapeHtml(model.business.phone);
  const vatPct = String(model.vatRatePct);

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
              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">Your booking is confirmed ✅</h1>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;line-height:1.5;">
                Thanks for booking with ${escapeHtml(operator)}. Here are your details.
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                ${detailRows}
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px 0;">
                ${lineRows}
                <tr>
                  <td style="padding:12px 0 0 0;color:${INK};font-size:15px;font-weight:bold;">Total</td>
                  <td style="padding:12px 0 0 0;color:${INK};font-size:15px;font-weight:bold;text-align:right;white-space:nowrap;">${totalHtml}</td>
                </tr>
              </table>
              <p style="margin:4px 0 20px 0;color:${MUTED};font-size:12px;">(incl. ${escapeHtml(vatPct)}% VAT)</p>

              <p style="margin:0 0 20px 0;color:${INK};font-size:14px;line-height:1.5;">
                Your invoice &amp; receipt are attached as a PDF.
              </p>

              <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.6;">
                Questions? Contact us at
                <a href="mailto:${supportEmail}" style="color:${ACCENT};">${supportEmail}</a>
                or ${supportPhone}.
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
    `Hi ${model.customer.name},`,
    '',
    `Good news — your booking ${ref} is confirmed (total ${totalStr}).`,
    '',
    `Activity: ${activity}`,
  ];
  if (when) textLines.push(`Date: ${when}`);
  if (model.booking.pickup) textLines.push(`Pick-up: ${model.booking.pickup}`);
  if (model.booking.dropoff) textLines.push(`Drop-off: ${model.booking.dropoff}`);
  textLines.push('');
  for (const line of model.lines) {
    textLines.push(`  - ${line.description}: ${money(model.currency, line.lineGrossEur)}`);
  }
  textLines.push('');
  textLines.push(`Total: ${totalStr} (incl. ${vatPct}% VAT)`);
  textLines.push('');
  textLines.push('Your invoice & receipt are attached as a PDF.');
  textLines.push('');
  textLines.push(`Questions? Contact us at ${model.business.email} or ${model.business.phone}.`);
  textLines.push('');
  textLines.push(operator);

  const text = textLines.join('\n');

  return { subject, html, text };
}
