import { escapeHtml } from './booking-confirmation';
import { translate } from '@/lib/i18n/translate';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import type { RenderedEmail } from './review-request';

/**
 * The one checkout-recovery email (see 20261017000100_checkout_recovery_email.sql). A SERVICE message
 * about the shopper's own unfinished booking — no offers, no other tours — sent once, with a plain
 * "stop these" link. It points at the activity page, where booking again takes a fresh hold and a
 * fresh checkout; nothing in it carries the expired booking's ref.
 *
 * Same email-safe construction as review-request.ts (inline styles, table layout, ~600px). No I/O,
 * no Date.now(): the caller passes every value in.
 */

const ACCENT = '#0E8C92';
const INK = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

export interface CheckoutRecoveryInput {
  customerName: string;
  activityTitle: string;
  /** ISO timestamp of the first slot the shopper picked; omitted from the copy when unparseable. */
  startsAt: string | null;
  bookAgainUrl: string;
  stopUrl: string;
  locale?: Locale | string | null;
}

function formatTripDate(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Indian/Mauritius',
  }).format(d);
}

export function renderCheckoutRecoveryEmail(input: CheckoutRecoveryInput): RenderedEmail {
  const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const operator = 'Belle Mare Tours';
  const date = formatTripDate(input.startsAt, locale);

  const subject = t('Your {activity} booking wasn’t completed', { activity: input.activityTitle });
  const intro = date
    ? t(
        'Hi {name}, your booking for {activity} on {date} wasn’t completed, so nothing was charged and the place wasn’t kept for you.',
        { name: input.customerName, activity: input.activityTitle, date },
      )
    : t(
        'Hi {name}, your booking for {activity} wasn’t completed, so nothing was charged and the place wasn’t kept for you.',
        { name: input.customerName, activity: input.activityTitle },
      );
  const again = t('If you’d still like to go, you can book it again in a minute:');
  const cta = t('Book {activity} again', { activity: input.activityTitle });
  const cardHelp = t(
    'Card trouble? Some banks ask you to approve a payment to Mauritius in their app first. If it still won’t go through, just reply to this email and we’ll help you book.',
  );
  const why = t(
    'You’re getting this one-time email because you started a booking on our website. We won’t send another about it.',
  );
  const stop = t('Don’t want reminders like this?');
  const stopLink = t('Stop them');

  const html = `<!-- ${operator} checkout recovery -->
<div style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <tr>
            <td style="background:${ACCENT};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;">
              ${operator}
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 12px 0;color:${INK};font-size:20px;">${escapeHtml(subject)}</h1>
              <p style="margin:0 0 12px 0;color:${INK};font-size:14px;line-height:1.6;">${escapeHtml(intro)}</p>
              <p style="margin:0 0 16px 0;color:${INK};font-size:14px;line-height:1.6;">${escapeHtml(again)}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="border-radius:6px;background:${ACCENT};">
                    <a href="${escapeHtml(input.bookAgainUrl)}" style="display:inline-block;padding:12px 20px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:6px;">${escapeHtml(cta)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.6;">${escapeHtml(cardHelp)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;line-height:1.6;">
              ${escapeHtml(why)}<br />
              ${escapeHtml(stop)} <a href="${escapeHtml(input.stopUrl)}" style="color:${MUTED};">${escapeHtml(stopLink)}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;

  const text = [
    intro,
    '',
    again,
    input.bookAgainUrl,
    '',
    cardHelp,
    '',
    '—',
    why,
    `${stop} ${input.stopUrl}`,
  ].join('\n');

  return { subject, html, text };
}
