import { describe, expect, it } from 'vitest';
import { localeFromCookieHeader } from '@/lib/http/context';

/**
 * API routes must resolve the guest's language from the request itself. Reading it via next/headers
 * `cookies()` instead would force dynamic rendering on routes that are deliberately static (notably
 * app/sitemap.ts), so the locale is parsed from the Cookie header here.
 */
describe('localeFromCookieHeader', () => {
  it('reads the language cookie', () => {
    expect(localeFromCookieHeader('gytm_lang=fr')).toBe('fr');
  });

  it('finds the cookie among others, in any position', () => {
    expect(localeFromCookieHeader('gytm_ccy=USD; gytm_lang=fr; other=1')).toBe('fr');
    expect(localeFromCookieHeader('gytm_lang=fr; gytm_ccy=USD')).toBe('fr');
  });

  it('defaults to English when absent, empty, or not a supported locale', () => {
    expect(localeFromCookieHeader(null)).toBe('en');
    expect(localeFromCookieHeader('')).toBe('en');
    expect(localeFromCookieHeader('gytm_ccy=USD')).toBe('en');
    expect(localeFromCookieHeader('gytm_lang=de')).toBe('en');
  });

  it('does not match a cookie whose name merely ends with the cookie name', () => {
    expect(localeFromCookieHeader('x_gytm_lang=fr')).toBe('en');
  });
});
