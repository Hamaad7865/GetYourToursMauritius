import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE } from '@/lib/i18n/config';
import { LOCALE_HEADER, splitLocalePath } from '@/lib/i18n/routing';
import { NO_STORE_PATHS, PAGE_SECURITY_HEADERS } from '@/lib/security-headers';

/**
 * Makes French URL-addressable.
 *
 * `/fr/activities` is REWRITTEN (not redirected) to `/activities`, with the locale carried to the
 * page in a request header. So there is one set of route files serving both languages, the French
 * URL stays in the address bar, and `getLocale()` resolves from the URL instead of a cookie.
 *
 * Why this matters beyond the address bar: locale used to live only in the `gytm_lang` cookie, which
 * meant French had no URL at all — nothing to put in a sitemap, nothing to hang an hreflang off, and
 * nothing a crawler could ever reach, since crawlers do not carry cookies. The French catalogue was
 * therefore invisible to search. It also made the visitemaurice.com redirects lossy: a cross-domain
 * 301 cannot set a cookie on the destination, so every French legacy URL landed on English.
 *
 * A rewrite, not a redirect, so the prefix survives; and English is untouched at the root, so no
 * existing URL moves and no ranking signal is reset.
 *
 * Keep the imports here minimal and pure. This file is bundled for the edge, and an import that
 * drags in server-only internals breaks the next-on-pages build well after typecheck and the test
 * suite have gone green.
 */
export function middleware(request: NextRequest): NextResponse {
  const { locale, path } = splitLocalePath(request.nextUrl.pathname);

  const headers = new Headers(request.headers);
  // Always drop an inbound copy first: the header is trusted downstream, so it must be ours.
  headers.delete(LOCALE_HEADER);

  // English keeps the bare path. Pass through untouched — in particular do NOT rewrite away a
  // trailing slash here, so Next's own 308 normalisation still happens exactly as before.
  if (locale === DEFAULT_LOCALE) {
    return withPageHeaders(NextResponse.next({ request: { headers } }), locale, path);
  }

  headers.set(LOCALE_HEADER, locale);
  const url = request.nextUrl.clone();
  url.pathname = path;
  return withPageHeaders(NextResponse.rewrite(url, { request: { headers } }), locale, path);
}

/**
 * Response headers for a page. next.config.mjs `headers()` never reaches a response that went
 * through this middleware on Cloudflare Pages, so the page-level ones are set here instead (see
 * src/lib/security-headers.ts). `Content-Language` tells crawlers that don't run JavaScript which
 * language the page is in — the root layout is static and always says `lang="en"`, correcting it
 * only client-side.
 */
function withPageHeaders(res: NextResponse, locale: string, path: string): NextResponse {
  for (const [name, value] of PAGE_SECURITY_HEADERS) res.headers.set(name, value);
  res.headers.set('Content-Language', locale);
  if (NO_STORE_PATHS.includes(path)) res.headers.set('Cache-Control', 'no-store, must-revalidate');
  return res;
}

export const config = {
  /*
   * Everything except API routes, Next's own assets, and any path with a file extension. The
   * middleware is cheap (a header set, plus a rewrite on French paths only), but it runs per request
   * at the edge, so static assets have no business paying for it.
   */
  matcher: ['/((?!api/|_next/static/|_next/image/|.*\\.).*)'],
};
