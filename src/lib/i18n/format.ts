import type { Locale } from './config';

/** App locale → BCP-47 tag for Intl date/number formatting. We display British-style dates for
 *  English visitors and French (France) formatting for French visitors. */
const BCP47: Record<Locale, string> = { en: 'en-GB', fr: 'fr-FR' };

/**
 * Format a date for the active app locale. Pass the locale from `usePreferences().language`
 * (client) or `getLocale()` (server) so French visitors see French month/day names instead of a
 * hardcoded `en-GB`. Accepts a `Date` or an ISO string; returns `''` for an unparseable value.
 */
export function formatLocaleDate(
  value: Date | string,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(BCP47[locale], opts);
}
