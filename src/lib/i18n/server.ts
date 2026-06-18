import { cookies } from 'next/headers';
import {
  CCY_COOKIE,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  LANG_COOKIE,
  isCurrency,
  isLocale,
  type Currency,
  type Locale,
} from './config';
import { translate } from './translate';

/** The visitor's locale from the cookie (server components only). Defaults to English. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** The visitor's display currency from the cookie (server components only). Defaults to EUR. */
export async function getServerCurrency(): Promise<Currency> {
  const value = (await cookies()).get(CCY_COOKIE)?.value;
  return isCurrency(value) ? value : DEFAULT_CURRENCY;
}

/** A `t()` bound to the request's locale, for server components. */
export async function getT(): Promise<(key: string, vars?: Record<string, string | number>) => string> {
  const locale = await getLocale();
  return (key, vars) => translate(locale, key, vars);
}
