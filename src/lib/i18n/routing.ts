/**
 * Where each locale lives in the URL space.
 *
 * English stays at the root and French sits under /fr, so no existing URL moves and no ranking
 * signal is reset. This module is the ONLY place that knows the prefix: the middleware strips it,
 * page metadata builds its hreflang pair from it, the sitemap emits both sides of that pair, and the
 * legacy-domain Worker mirrors it in its own FR_PREFIX constant.
 *
 * Keep this file dependency-free apart from ./config — it is imported by middleware.ts, which is
 * bundled for the edge, and an import that reaches into React/Next server internals from there fails
 * the next-on-pages build long after typecheck and tests have gone green.
 */
import { DEFAULT_LOCALE, type Locale } from './config';

/** The URL prefix owned by each locale. English is deliberately empty — it keeps the bare paths. */
export const LOCALE_PREFIX: Record<Locale, string> = { en: '', fr: '/fr' };

/**
 * Request header the middleware uses to tell the page which locale the URL asked for.
 *
 * A header rather than a rewritten cookie: after the rewrite the page only sees `/activities`, so
 * the prefix is gone and something has to carry it. The middleware always DELETES any inbound copy
 * before setting its own, so a caller cannot force a locale by sending this header.
 */
export const LOCALE_HEADER = 'x-gytm-locale';

/** Drop a trailing slash, but never turn '/' into ''. */
function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') || '/' : path;
}

/**
 * Split a request path into the locale it addresses and the underlying (English-shaped) route.
 *
 * The prefix must match on a SEGMENT boundary: a plain `startsWith('/fr')` would also swallow
 * `/french-riviera`, serving French from an English URL with no way to tell from the outside.
 */
export function splitLocalePath(pathname: string): { locale: Locale; path: string } {
  const p = trimTrailingSlash(pathname || '/');
  if (p === '/fr') return { locale: 'fr', path: '/' };
  if (p.startsWith('/fr/')) return { locale: 'fr', path: p.slice('/fr'.length) };
  return { locale: DEFAULT_LOCALE, path: p };
}

/**
 * The URL a route has in a given locale. Accepts an already-prefixed path, so callers can hand it
 * `usePathname()` output without first working out which locale they are on.
 */
export function localePath(locale: Locale, path: string): string {
  const { path: bare } = splitLocalePath(path);
  const prefix = LOCALE_PREFIX[locale];
  if (!prefix) return bare;
  // '/fr' + '/' would be '/fr/', which Next then 308s to '/fr' — a pointless redirect on the most
  // linked French URL, and a mismatch against the canonical and the sitemap entry.
  return bare === '/' ? prefix : `${prefix}${bare}`;
}

/**
 * Pages whose SUBSTANTIVE content is English at every URL.
 *
 * The legal pages render French chrome around an English body plus a "this page is available in
 * English only" notice — deliberate, because the English text is the legally binding version. So
 * /fr/terms is not a translation of /terms, it is the same document at a second URL, and claiming
 * hreflang="fr" for it advertises a translation that does not exist. Google then either discards the
 * annotation or reads the two as duplicates.
 *
 * /cookies is NOT in this list: it is fully translated and keeps its pair.
 */
export const ENGLISH_ONLY_PATHS: readonly string[] = ['/terms', '/privacy', '/refunds'];

/** Whether a path (prefixed or not) is one of the deliberately-untranslated pages. */
export function isEnglishOnly(path: string): boolean {
  return ENGLISH_ONLY_PATHS.includes(splitLocalePath(path).path);
}

/**
 * Sections that have no French URL of their own: the booking funnel, the signed-in area and the back
 * office. They render in the visitor's language from the cookie, at one URL. Everything else public
 * is published in both languages (see app/sitemap.ts), so the list is what is EXCLUDED — a new
 * content page is bilingual by default instead of silently staying English-linked.
 */
const UNLOCALISED_PREFIXES: readonly string[] = [
  '/api',
  '/admin',
  '/account',
  '/auth',
  '/checkout',
  '/cart',
  '/wishlist',
  '/bookings',
  '/quotes',
  '/_next',
];

/** Whether a bare (unprefixed) route is published under /fr as well. */
export function hasLocalisedUrl(path: string): boolean {
  const { path: bare } = splitLocalePath(path);
  if (isEnglishOnly(bare)) return false;
  // A file (a PDF, an image, the sitemap), not a page.
  if (/\.[a-z0-9]+$/i.test(bare)) return false;
  return !UNLOCALISED_PREFIXES.some((p) => bare === p || bare.startsWith(`${p}/`));
}

/**
 * The href an internal link should carry on a page rendered in `locale`.
 *
 * Until this existed almost every link on a French page pointed at the English URL: the middleware
 * rewrites /fr/… on the way IN, but nothing put the prefix back on the way out. A crawl on
 * 2026-10-13 found 154 of 236 French pages with no internal link from anywhere — they were reachable
 * only through the sitemap, and a French visitor was dropped into English by their first click.
 *
 * Deliberately narrow: English pages get their hrefs back byte-for-byte, an href that already names
 * a locale is left as written (a language switch must stay a language switch), and anything that is
 * not a root-relative page path — external, mailto:, tel:, `#anchor` — passes straight through. The
 * query and hash are held aside so `/?q=1` becomes `/fr?q=1`, not `/fr/?q=1` (which Next 308s).
 */
export function localiseHref(locale: Locale, href: string): string {
  if (!LOCALE_PREFIX[locale]) return href;
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? '' : href.slice(cut);
  if (splitLocalePath(path).locale !== DEFAULT_LOCALE) return href;
  if (!hasLocalisedUrl(path)) return href;
  return `${localePath(locale, path)}${rest}`;
}

/**
 * `metadata.alternates` for a public page: the canonical for the URL actually being rendered, plus
 * the full hreflang set.
 *
 * The canonical MUST follow the rendered locale. Pointing a French page's canonical at the English
 * URL tells Google the French page is a duplicate, and it drops out of the index entirely — which is
 * worse than having no French URLs at all. Both sides emit the identical `languages` map because
 * Google discards an hreflang annotation that the other side does not reciprocate.
 *
 * The exception is ENGLISH_ONLY_PATHS, where that reasoning inverts: those two URLs really ARE the
 * same document, so they get no hreflang and both canonicalise to the English URL — which keeps
 * /fr/terms reachable and French-framed for a visitor while consolidating it in the index instead of
 * competing with /terms.
 */
export function localeAlternates(
  path: string,
  locale: Locale = DEFAULT_LOCALE,
): { canonical: string; languages?: Record<string, string> } {
  const { path: bare } = splitLocalePath(path);
  if (isEnglishOnly(bare)) return { canonical: localePath(DEFAULT_LOCALE, bare) };
  return {
    canonical: localePath(locale, bare),
    languages: {
      en: localePath('en', bare),
      fr: localePath('fr', bare),
      // x-default is where an unmatched language should land: the English page.
      'x-default': localePath(DEFAULT_LOCALE, bare),
    },
  };
}
