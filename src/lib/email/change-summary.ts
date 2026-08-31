import { formatMauritiusDate } from '@/lib/invoice/mauritius-time';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';

/**
 * The "Previously booked / Now booked / Difference" fragment shared by three emails: the full
 * invoice-with-PDF confirmation for an upgrade or level move, the lightweight PDF-less notice for a
 * downgrade that hasn't been refunded yet, and the refund-confirmed follow-up once it has. One
 * renderer, three call sites, so the story reads identically wherever it appears.
 *
 * Deliberately duplicates booking-confirmation.ts's four color constants, its money() shape AND
 * escapeHtml — NOT importing any of them — because booking-confirmation.ts imports THIS module (for
 * the fragment it splices into the invoice email), so importing back from it would be a circular
 * dependency. pickup.ts's "duplicate the styling, don't share it" convention already covers the
 * constants/money(); escapeHtml joins them here for the same reason, not because it's meant to drift
 * — it's a 7-line pure function with no dependencies of its own, low-risk to keep in step by eye.
 *
 * Pure: no I/O, no Date.now()/new Date(). Every value comes from the caller.
 */

const ACCENT = '#0E8C92';
const INK = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const CORAL = '#dc2626';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toFixed(2)}`;
}

/** A tour name, its option (if named beyond "Standard"-style defaults) and its date, one line. */
function tourLine(
  activityTitle: string,
  optionName: string | null | undefined,
  startsAt: string | null | undefined,
): string {
  const parts = [activityTitle];
  if (optionName) parts.push(optionName);
  const joined = parts.join(' — ');
  const when = startsAt ? formatMauritiusDate(startsAt) : '';
  return when ? `${joined} · ${when}` : joined;
}

export interface ChangeSummaryInput {
  locale: Locale;
  currency: string;
  fromActivityTitle: string;
  fromOptionName?: string | null;
  fromStartsAt?: string | null;
  fromTotalEur: number;
  toActivityTitle: string;
  toOptionName?: string | null;
  toStartsAt?: string | null;
  toTotalEur: number;
  /** Signed — positive means the guest paid it, negative means it is owed back. */
  differenceEur: number;
  /** Irrelevant when `differenceEur >= 0` — an upgrade/level move has nothing to refund. */
  refundStatus: 'none' | 'pending' | 'refunded';
  refundedAt?: string | null;
}

export interface ChangeSummaryFragment {
  html: string;
  text: string;
}

export function renderChangeSummaryFragment(input: ChangeSummaryInput): ChangeSummaryFragment {
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(input.locale, key, vars);
  const from = tourLine(input.fromActivityTitle, input.fromOptionName, input.fromStartsAt);
  const to = tourLine(input.toActivityTitle, input.toOptionName, input.toStartsAt);
  const fromTotal = money(input.currency, input.fromTotalEur);
  const toTotal = money(input.currency, input.toTotalEur);

  const diff = input.differenceEur;
  const diffColor = diff < 0 ? CORAL : ACCENT;
  const diffLabel =
    diff > 0
      ? t('Charged')
      : diff < 0
        ? input.refundStatus === 'refunded'
          ? t('Refunded')
          : t('Refund pending')
        : t('Difference');
  const diffValue =
    diff > 0
      ? `+${money(input.currency, diff)}`
      : diff < 0
        ? money(input.currency, Math.abs(diff))
        : t('No extra charge');
  const diffNote =
    diff < 0 && input.refundStatus === 'refunded' && input.refundedAt
      ? t('on {date}', { date: formatMauritiusDate(input.refundedAt) })
      : diff < 0 && input.refundStatus === 'pending'
        ? t('to the card you paid with')
        : '';

  const row = (label: string, value: string, valueHtml: string): string => `
            <tr>
              <td style="padding:4px 0;color:${MUTED};font-size:13.5px;width:110px;vertical-align:top;">${escapeHtml(label)}</td>
              <td style="padding:4px 0;color:${INK};font-size:13.5px;">${valueHtml}</td>
            </tr>`;

  const html = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;background:#f9fafb;border:1px solid ${BORDER};border-radius:8px;padding:16px;">
        <tr><td style="padding:0 0 8px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${row(t('Previously'), from, `${escapeHtml(from)}<div style="color:${MUTED};font-size:12.5px;">${escapeHtml(fromTotal)}</div>`)}
            ${row(t('Now'), to, `${escapeHtml(to)}<div style="color:${MUTED};font-size:12.5px;">${escapeHtml(toTotal)}</div>`)}
            <tr>
              <td style="padding:8px 0 0 0;color:${MUTED};font-size:13.5px;width:110px;vertical-align:top;border-top:1px solid ${BORDER};">${escapeHtml(diffLabel)}</td>
              <td style="padding:8px 0 0 0;color:${diffColor};font-size:14px;font-weight:bold;border-top:1px solid ${BORDER};">${escapeHtml(diffValue)}${diffNote ? ` <span style="color:${MUTED};font-weight:normal;font-size:12.5px;">${escapeHtml(diffNote)}</span>` : ''}</td>
            </tr>
          </table>
        </td></tr>
      </table>`;

  const text = [
    `${t('Previously')}: ${from} (${fromTotal})`,
    `${t('Now')}: ${to} (${toTotal})`,
    `${diffLabel}: ${diffValue}${diffNote ? ` ${diffNote}` : ''}`,
  ].join('\n');

  return { html, text };
}
