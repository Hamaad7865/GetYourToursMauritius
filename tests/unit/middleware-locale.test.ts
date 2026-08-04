import { describe, expect, it } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';
import { middleware } from '../../middleware';
import { LOCALE_HEADER } from '@/lib/i18n/routing';

/**
 * The middleware is what makes French URL-addressable: /fr/x is rewritten to x with the locale
 * carried in a request header. Two properties are load-bearing and easy to break silently —
 * the rewrite must keep the French URL in the address bar (rewrite, never redirect), and the locale
 * header must never be honoured from the inbound request.
 *
 * Next exposes a rewrite as `x-middleware-rewrite` and forwarded request headers as
 * `x-middleware-request-<name>`, which is what these assertions read.
 */
function run(url: string, headers?: Record<string, string>): NextResponse {
  return middleware(new NextRequest(url, headers ? { headers } : undefined));
}

const rewriteOf = (res: NextResponse): string | null => {
  const raw = res.headers.get('x-middleware-rewrite');
  return raw === null ? null : new URL(raw).pathname;
};

const forwardedLocale = (res: NextResponse): string | null =>
  res.headers.get(`x-middleware-request-${LOCALE_HEADER}`);

const BASE = 'https://bellemaretours.com';

describe('locale middleware', () => {
  it('rewrites a French URL onto the shared route and tags the locale', () => {
    const res = run(`${BASE}/fr/activities`);
    expect(rewriteOf(res)).toBe('/activities');
    expect(forwardedLocale(res)).toBe('fr');
  });

  it('rewrites the French home page', () => {
    expect(rewriteOf(run(`${BASE}/fr`))).toBe('/');
  });

  it('rewrites a deep French URL', () => {
    expect(rewriteOf(run(`${BASE}/fr/activities/la-vallee-des-couleurs-nature-park-2`))).toBe(
      '/activities/la-vallee-des-couleurs-nature-park-2',
    );
  });

  // A redirect would strip the prefix back off and undo the whole point: the French URL has to
  // survive in the address bar, be linkable, and be what the canonical tag names.
  it('rewrites rather than redirects, so the /fr URL stays in the address bar', () => {
    const res = run(`${BASE}/fr/activities`);
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('leaves English paths alone', () => {
    const res = run(`${BASE}/activities`);
    expect(rewriteOf(res)).toBeNull();
    expect(forwardedLocale(res)).toBeFalsy();
  });

  it('does not treat a path merely starting with fr as French', () => {
    expect(rewriteOf(run(`${BASE}/french-riviera`))).toBeNull();
  });

  // The header is trusted downstream by getLocale(), so an inbound copy must never win.
  it('ignores an inbound locale header on an English URL', () => {
    const res = run(`${BASE}/activities`, { [LOCALE_HEADER]: 'fr' });
    expect(forwardedLocale(res)).toBeFalsy();
  });

  it('overwrites an inbound locale header on a French URL', () => {
    const res = run(`${BASE}/fr/activities`, { [LOCALE_HEADER]: 'nonsense' });
    expect(forwardedLocale(res)).toBe('fr');
  });

  it('preserves the query string across the rewrite', () => {
    const res = run(`${BASE}/fr/activities?category=Taxi&page=2`);
    const raw = res.headers.get('x-middleware-rewrite');
    expect(raw).not.toBeNull();
    expect(new URL(raw as string).search).toBe('?category=Taxi&page=2');
  });
});
