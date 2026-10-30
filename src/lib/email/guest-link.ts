import { button, shell, type RenderedEmail } from './pickup';
import { escapeHtml } from './booking-confirmation';
import { translate } from '@/lib/i18n/translate';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';

const INK = '#1f2937';
const MUTED = '#6b7280';

export interface GuestLinkEmailInput {
  customerName: string;
  ref: string;
  bookingUrl: string;
  locale?: Locale | string | null;
}

/**
 * The answer to "Find my booking" (POST /api/v1/bookings/lookup): one link to the booking, sent to the
 * address on it. Localised from the booking, since the drain sends it off-request.
 */
export function renderGuestLinkEmail(input: GuestLinkEmailInput): RenderedEmail {
  const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);

  const subject = t('Your link to booking {ref}', { ref: input.ref });
  const lead = t(
    'Hi {name}, here is the link you asked for. It opens your booking on this device.',
    {
      name: input.customerName,
    },
  );
  const note = t(
    'Keep this link private: anyone who has it can manage this booking. If you did not ask for it, you can ignore this email.',
  );

  const html = shell(
    `              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">${escapeHtml(subject)}</h1>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;line-height:1.5;">${escapeHtml(lead)}</p>
              ${button(input.bookingUrl, t('View my booking'))}
              <p style="margin:20px 0 0 0;color:${MUTED};font-size:13px;line-height:1.6;">${escapeHtml(note)}</p>`,
    'booking link',
  );

  const text = [lead, '', `${t('View my booking')}: ${input.bookingUrl}`, '', note].join('\n');
  return { subject, html, text };
}
