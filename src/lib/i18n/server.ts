import { cookies, headers } from 'next/headers';
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
import { LOCALE_HEADER } from './routing';
import { translate } from './translate';

/**
 * The visitor's locale (server components only). Defaults to English.
 *
 * The URL wins over the cookie. `/fr/...` is rewritten by middleware.ts, which tags the request with
 * LOCALE_HEADER — so a French URL renders French for everyone, including crawlers, which carry no
 * cookies and are the entire reason French needed a URL of its own.
 *
 * The cookie remains the fallback for unprefixed paths, so a visitor who picked French before this
 * existed, or who is on a page with no French URL (checkout, account), still gets French.
 */
export async function getLocale(): Promise<Locale> {
  const fromUrl = (await headers()).get(LOCALE_HEADER);
  if (isLocale(fromUrl)) return fromUrl;
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** The visitor's display currency from the cookie (server components only). Defaults to EUR. */
export async function getServerCurrency(): Promise<Currency> {
  const value = (await cookies()).get(CCY_COOKIE)?.value;
  return isCurrency(value) ? value : DEFAULT_CURRENCY;
}

/** A `t()` bound to the request's locale, for server components. */
export async function getT(): Promise<
  (key: string, vars?: Record<string, string | number>) => string
> {
  const locale = await getLocale();
  return (key, vars) => translate(locale, key, vars);
}
