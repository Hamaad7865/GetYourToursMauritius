import { escapeHtml } from './booking-confirmation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/translate';
import { SITE } from '@/lib/seo/site';
import { ValidationError } from '@/lib/services/errors';

const ACCENT = '#0E8C92';
const INK = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

export interface PhotoBalanceEmailInput {
  ref: string;
  customerName: string;
  packageTitle: string | null;
  currency: string;
  balanceDueMinor: number;
  locale: string | null;
}
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function money(currency: string, minorAmount: number): string {
  return `${currency} ${(minorAmount / 100).toFixed(2)}`;
}

/**
 * "Your photos are ready — here is the balance." Sent by staff from /admin/photography once the
 * gallery is delivered. The link is the guest's own booking page (/bookings/{ref}), where the signed-in
 * owner presses "Pay the balance" — the charge is the booking's balance_due_minor, read by
 * create_payment, never anything in this email. No token rides in the URL: the booking page is
 * authenticated by the guest's account, exactly like every other booking link.
 */
export function renderPhotoBalanceEmail(input: PhotoBalanceEmailInput): RenderedEmail {
  if (!Number.isSafeInteger(input.balanceDueMinor) || input.balanceDueMinor <= 0) {
    throw new ValidationError(
      `Booking ${input.ref} has no balance to collect, so there is nothing to email a link for.`,
    );
  }
  const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const operator = SITE.operator;
  // #balance-payment lands the guest on the pay box (the booking page scrolls to it once loaded).
  const url = `${SITE.url}/bookings/${encodeURIComponent(input.ref)}#balance-payment`;
  const amount = money(input.currency, input.balanceDueMinor);
  const first = input.customerName.trim().split(/\s+/)[0] || input.customerName;
  const what = input.packageTitle?.trim() || t('your photography booking');

  const subject = t('Your photos are ready — balance for booking {ref}', { ref: input.ref });
  const greeting = t('Hi {name},', { name: first });
  const lead = t(
    'Your photos from {package} are ready. To receive your gallery, please pay the remaining balance of {amount}.',
    { package: what, amount },
  );
  const how = t(
    'Open your booking and press “Pay the balance” — you can pay securely by card in a minute.',
  );
  const cta = t('Pay the balance');
  const thanks = t('Thank you for shooting with {operator}!', { operator });

  const html = `<!-- ${escapeHtml(operator)} photo balance ${escapeHtml(input.ref)} -->
<div style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr><td style="background:${ACCENT};font-size:0;line-height:0;height:4px;">&nbsp;</td></tr>
        <tr><td style="padding:22px 28px 18px;border-bottom:1px solid ${BORDER};">
          <a href="${SITE.url}" style="text-decoration:none;color:${INK};font-size:18px;font-weight:bold;">
            <img src="${SITE.url}/logo.png" width="170" alt="${escapeHtml(operator)}" style="display:block;border:0;width:170px;max-width:170px;height:auto;" />
          </a>
        </td></tr>
        <tr><td style="padding:24px 28px 8px;color:${INK};font-size:15px;line-height:1.6;">
          <p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 12px;">${escapeHtml(lead)}</p>
          <p style="margin:0 0 20px;color:${MUTED};font-size:14px;">${escapeHtml(how)}</p>
          <p style="margin:0 0 24px;">
            <a href="${escapeHtml(url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px;">${escapeHtml(cta)} · ${escapeHtml(amount)}</a>
          </p>
          <p style="margin:0 0 6px;color:${MUTED};font-size:13px;">${escapeHtml(t('Booking ref'))}: <b style="color:${INK};">${escapeHtml(input.ref)}</b></p>
          <p style="margin:16px 0 0;">${escapeHtml(thanks)}</p>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;color:${MUTED};font-size:12px;border-top:1px solid ${BORDER};">
          ${escapeHtml(SITE.operator)} · ${escapeHtml(SITE.email)} · ${escapeHtml(SITE.phone)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;

  const text = [
    greeting,
    '',
    lead,
    how,
    '',
    `${cta}: ${url}`,
    `${t('Booking ref')}: ${input.ref}`,
    '',
    thanks,
    `${SITE.operator} · ${SITE.email} · ${SITE.phone}`,
  ].join('\n');

  return { subject, html, text };
}

export interface GalleryReadyEmailInput {
  ref: string;
  customerName: string;
  packageTitle: string | null;
  photoCount: number;
  locale: string | null;
  /**
   * The gallery link. The admin send route omits it and lets the renderer build
   * /bookings/{ref}#gallery off SITE.url; the drain passes the RELATIVE path the
   * notify_balance_paid trigger persisted on the outbox payload ('/bookings/<ref>#gallery'),
   * which is absolutised here the same way. An absolute http(s) URL is used as-is.
   */
  galleryUrl?: string | null;
}

/**
 * "Your gallery is ready." Sent when a photography booking's photos are delivered: by staff from
 * /admin/photography ("Send gallery link" / "Confirm gallery complete"), or automatically by the
 * notify_balance_paid trigger when the balance settles in full and the gallery already exists.
 * The link is the guest's own booking page scrolled to their private gallery
 * (/bookings/{ref}#gallery) — authenticated by the guest's account, exactly like every other
 * booking link, so no token rides in the URL.
 */
export function renderGalleryReadyEmail(input: GalleryReadyEmailInput): RenderedEmail {
  if (!Number.isSafeInteger(input.photoCount) || input.photoCount <= 0) {
    throw new ValidationError(
      `Booking ${input.ref} has no gallery photos yet, so there is nothing to email a link for.`,
    );
  }
  const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const operator = SITE.operator;
  const path = input.galleryUrl?.trim() || `/bookings/${encodeURIComponent(input.ref)}#gallery`;
  const url = /^https?:\/\//i.test(path)
    ? path
    : `${SITE.url}${path.startsWith('/') ? path : `/${path}`}`;
  const first = input.customerName.trim().split(/\s+/)[0] || input.customerName;
  const what = input.packageTitle?.trim() || t('your photography booking');

  const subject = t('Your gallery is ready — booking {ref}', { ref: input.ref });
  const greeting = t('Hi {name},', { name: first });
  const lead = t('Your {count} photos from {package} are ready in your private online gallery.', {
    count: input.photoCount,
    package: what,
  });
  const how = t(
    'Open your booking and scroll to your gallery — you can view and share them there.',
  );
  const cta = t('View my gallery');
  const thanks = t('Thank you for shooting with {operator}!', { operator });

  const html = `<!-- ${escapeHtml(operator)} gallery ${escapeHtml(input.ref)} -->
<div style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr><td style="background:${ACCENT};font-size:0;line-height:0;height:4px;">&nbsp;</td></tr>
        <tr><td style="padding:22px 28px 18px;border-bottom:1px solid ${BORDER};">
          <a href="${SITE.url}" style="text-decoration:none;color:${INK};font-size:18px;font-weight:bold;">
            <img src="${SITE.url}/logo.png" width="170" alt="${escapeHtml(operator)}" style="display:block;border:0;width:170px;max-width:170px;height:auto;" />
          </a>
        </td></tr>
        <tr><td style="padding:24px 28px 8px;color:${INK};font-size:15px;line-height:1.6;">
          <p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 12px;">${escapeHtml(lead)}</p>
          <p style="margin:0 0 20px;color:${MUTED};font-size:14px;">${escapeHtml(how)}</p>
          <p style="margin:0 0 24px;">
            <a href="${escapeHtml(url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px;">${escapeHtml(cta)}</a>
          </p>
          <p style="margin:0 0 6px;color:${MUTED};font-size:13px;">${escapeHtml(t('Booking ref'))}: <b style="color:${INK};">${escapeHtml(input.ref)}</b></p>
          <p style="margin:16px 0 0;">${escapeHtml(thanks)}</p>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;color:${MUTED};font-size:12px;border-top:1px solid ${BORDER};">
          ${escapeHtml(SITE.operator)} · ${escapeHtml(SITE.email)} · ${escapeHtml(SITE.phone)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;

  const text = [
    greeting,
    '',
    lead,
    how,
    '',
    `${cta}: ${url}`,
    `${t('Booking ref')}: ${input.ref}`,
    '',
    thanks,
    `${SITE.operator} · ${SITE.email} · ${SITE.phone}`,
  ].join('\n');

  return { subject, html, text };
}
