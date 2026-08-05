import { escapeHtml } from './booking-confirmation';
import { translate } from '@/lib/i18n/translate';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';

/**
 * The two guest emails of the late-pickup flow:
 *
 *   pickup_reminder  — sent 48h and again 24h before departure while a booking taken as "pickup to be
 *                      arranged" still has no address. One CTA: open the booking and set it.
 *   pickup_confirmed — sent once the transport supplement settles and the address is on the booking.
 *
 * Both mirror review-request.ts's email-safe construction (inline styles, table layout, ~600px) and
 * are localised from the guest's stored booking locale — these are sent off-request by a cron sweep,
 * so the sender's locale is meaningless. No I/O, no Date.now().
 */

const ACCENT = '#0E8C92';
const INK = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const OPERATOR = 'Belle Mare Tours';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function shell(bodyHtml: string): string {
  return `<!-- ${OPERATOR} pickup -->
<div style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <tr>
            <td style="background:${ACCENT};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;">
              ${OPERATOR}
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
              ${OPERATOR}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

function button(href: string, label: string): string {
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block;margin:0 8px 8px 0;">
                <tr>
                  <td style="border-radius:6px;background:${ACCENT};">
                    <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
                  </td>
                </tr>
              </table>`;
}

export interface PickupReminderInput {
  customerName: string;
  activityTitle: string;
  bookingUrl: string;
  /** 48 or 24 — the threshold that fired, which is the only thing that changes the tone. */
  hoursBefore: number;
  locale?: Locale | string | null;
}

export function renderPickupReminderEmail(input: PickupReminderInput): RenderedEmail {
  const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const urgent = input.hoursBefore <= 24;

  const subject = urgent
    ? t('Tomorrow: where should we collect you for {activity}?', { activity: input.activityTitle })
    : t('Where should we collect you for {activity}?', { activity: input.activityTitle });

  const lead = urgent
    ? t(
        "Hi {name}, your {activity} is tomorrow and we still don't have a pickup address. Add it now so your driver can be routed to you.",
        { name: input.customerName, activity: input.activityTitle },
      )
    : t(
        "Hi {name}, your {activity} is in two days. You chose to give us your pickup point later — here's the link to add it.",
        { name: input.customerName, activity: input.activityTitle },
      );

  const note = t(
    'If your pickup is further from the departure point, a transport supplement may apply — you will see the exact amount before you pay anything.',
  );

  const html =
    shell(`              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">${escapeHtml(subject)}</h1>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;line-height:1.5;">${escapeHtml(lead)}</p>
              ${button(input.bookingUrl, t('Add your pickup'))}
              <p style="margin:20px 0 0 0;color:${MUTED};font-size:13px;line-height:1.6;">${escapeHtml(note)}</p>`);

  const text = [
    t('Hi {name},', { name: input.customerName }),
    '',
    lead,
    '',
    `${t('Add your pickup')}: ${input.bookingUrl}`,
    '',
    note,
  ].join('\n');

  return { subject, html, text };
}

export interface PickupConfirmedInput {
  customerName: string;
  activityTitle: string;
  pickupLocation: string;
  bookingUrl: string;
  /** The supplement actually charged, in EUR. 0 when the pickup was in the same region. */
  feeEur: number;
  locale?: Locale | string | null;
}

export function renderPickupConfirmedEmail(input: PickupConfirmedInput): RenderedEmail {
  const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);

  const subject = t('Your pickup is confirmed — {activity}', { activity: input.activityTitle });
  const lead = t('Hi {name}, your driver will collect you at:', { name: input.customerName });
  // Place names are guest-supplied content: shown verbatim, never translated (and escaped below).
  const where = input.pickupLocation;
  const paid =
    input.feeEur > 0
      ? t('Transport supplement paid: €{amount}', { amount: input.feeEur.toFixed(2) })
      : null;

  const html =
    shell(`              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">${escapeHtml(subject)}</h1>
              <p style="margin:0 0 8px 0;color:${MUTED};font-size:14px;line-height:1.5;">${escapeHtml(lead)}</p>
              <p style="margin:0 0 20px 0;color:${INK};font-size:15px;font-weight:bold;line-height:1.5;">${escapeHtml(where)}</p>
              ${paid ? `<p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;">${escapeHtml(paid)}</p>` : ''}
              ${button(input.bookingUrl, t('View your booking'))}`);

  const text = [
    t('Hi {name},', { name: input.customerName }),
    '',
    lead,
    where,
    ...(paid ? ['', paid] : []),
    '',
    `${t('View your booking')}: ${input.bookingUrl}`,
  ].join('\n');

  return { subject, html, text };
}
