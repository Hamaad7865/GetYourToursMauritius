/**
 * How a manage link's token gets from an email to POST /bookings/{ref}/adopt without ever being in a
 * page URL, which GTM and Clarity would export (src/lib/quotes/link-cookie.ts has the full story).
 *
 * The emailed URL is GET /api/v1/bookings/{ref}/open?t=… . That route moves the token into this
 * httpOnly cookie and redirects to the clean booking page. The cookie's Path is the adopt route alone,
 * so it is sent nowhere else. It is a transport for the link proof, not an identity: adopt still needs a
 * Bearer JWT, and a mobile app sends the same token in the body instead.
 */
import type { Locale } from '@/lib/i18n/config';

export const GUEST_LINK_COOKIE = 'bmt_guest_link';

/** Long enough to read the page and tap "View my booking"; the emailed link itself keeps working. */
export const GUEST_LINK_COOKIE_MAX_AGE_SECONDS = 30 * 60;

/** Alphanumeric only: the ref is interpolated into a cookie `Path=`, where `;` would end the attribute. */
export function bookingRefLooksValid(ref: string): boolean {
  return /^[A-Za-z0-9]{1,32}$/.test(ref);
}

export function guestTokenLooksValid(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

export function guestLinkAdoptPath(ref: string): string {
  return `/api/v1/bookings/${ref}/adopt`;
}

/** The path an email links to. `l` carries the booking's language, so /open needs no database read. */
export function guestLinkOpenPath(ref: string, token: string, locale: Locale): string {
  const lang = locale === 'en' ? '' : `&l=${locale}`;
  return `/api/v1/bookings/${ref}/open?t=${token}${lang}`;
}

/**
 * Where /open sends the browser. `link=1` is what makes the booking page offer "View my booking".
 * /bookings has no /fr URL, so there is no language to put in this path; /open sets the cookie instead.
 */
export function guestLinkLandingPath(ref: string): string {
  return `/bookings/${ref}?link=1`;
}

/**
 * SameSite=Lax, not Strict: Strict would drop the cookie when the guest arrives from a mail client.
 * Lax also keeps a cross-site POST from carrying it.
 */
export function buildGuestLinkCookie(ref: string, token: string): string {
  return (
    `${GUEST_LINK_COOKIE}=${token}; Path=${guestLinkAdoptPath(ref)}; ` +
    `Max-Age=${GUEST_LINK_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`
  );
}

export function clearGuestLinkCookie(ref: string): string {
  return `${GUEST_LINK_COOKIE}=; Path=${guestLinkAdoptPath(ref)}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readGuestLinkCookie(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === GUEST_LINK_COOKIE) {
      const value = rest.join('=');
      return guestTokenLooksValid(value) ? value : null;
    }
  }
  return null;
}
