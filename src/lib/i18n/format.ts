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

/**
 * "2 min ago", "Yesterday", "3 days ago" — how long ago something happened, in the visitor's language
 * (Intl.RelativeTimeFormat, so no translation keys). Older than a week reads as a date ("8 Nov").
 */
export function formatRelativeTime(then: number, now: number, locale: Locale): string {
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(BCP47[locale], { numeric: 'auto', style: 'short' });
  const out =
    abs < 60
      ? rtf.format(0, 'second')
      : abs < 3600
        ? rtf.format(Math.round(seconds / 60), 'minute')
        : abs < 86_400
          ? rtf.format(Math.round(seconds / 3600), 'hour')
          : abs < 7 * 86_400
            ? rtf.format(Math.round(seconds / 86_400), 'day')
            : formatLocaleDate(new Date(then), locale, { day: 'numeric', month: 'short' });
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The island's clock. Every departure happens here, whatever timezone the guest's browser is in. */
export const TRIP_TIME_ZONE = 'Indian/Mauritius';

/**
 * The calendar day a trip runs on, read on the island's clock, e.g. "Sun, 15 Nov 2026".
 *
 * Use this for every date a guest PICKS or is TOLD about a trip, so the two can never disagree: the
 * reschedule list, the "moved to" notice, the booking page and the account cards. Browser-local time
 * can land a morning departure on the previous day for a guest in the Americas.
 */
export function formatTripDate(
  value: Date | string,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  },
): string {
  return formatLocaleDate(value, locale, { ...opts, timeZone: TRIP_TIME_ZONE });
}
