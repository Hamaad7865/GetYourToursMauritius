import { DEFAULT_LOCALE, LANG_COOKIE, isLocale, type Locale } from '@/lib/i18n/config';

/**
 * The visitor's locale from a raw Cookie header. Used instead of next/headers `cookies()` because
 * `cookies()` opts a route into dynamic rendering, which would be wrong for app/sitemap.ts.
 */
export function localeFromCookieHeader(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === LANG_COOKIE) {
      const value = rest.join('=');
      return isLocale(value) ? value : DEFAULT_LOCALE;
    }
  }
  return DEFAULT_LOCALE;
}
