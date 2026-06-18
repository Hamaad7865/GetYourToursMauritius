/** Locale + display-currency configuration, shared by the server (cookie reads) and client. */

export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export function isLocale(v: string | undefined | null): v is Locale {
  return v === 'en' || v === 'fr';
}

export const CURRENCIES = ['EUR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = 'EUR';
export function isCurrency(v: string | undefined | null): v is Currency {
  return v === 'EUR' || v === 'USD';
}

export const LANGUAGE_LABELS: Record<Locale, string> = { en: 'English', fr: 'Français' };
export const CURRENCY_LABELS: Record<Currency, { label: string; symbol: string }> = {
  EUR: { label: 'Euro', symbol: '€' },
  USD: { label: 'US Dollar', symbol: '$' },
};

// Cookies (not localStorage) so server-rendered pages can localise + price at SSR. Underscore names
// keep them safe across cookie parsers.
export const LANG_COOKIE = 'gytm_lang';
export const CCY_COOKIE = 'gytm_ccy';
export const PREF_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
