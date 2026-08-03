/**
 * visitemaurice.com → bellemaretours.com — the legacy-domain redirector.
 *
 * The old WordPress site is being retired. This Worker replaces it entirely: it owns the domain,
 * answers every request with a 301 to the matching page on the canonical site, and needs no origin,
 * so the WordPress hosting can be cancelled once mail has been dealt with separately (see README).
 *
 * Why a Worker rather than dashboard Redirect Rules: the map is 199 entries across two languages,
 * which is well past what Redirect Rules comfortably hold, and here it is version-controlled,
 * reviewed in a PR, and covered by tests/unit/legacy-redirects.test.ts — which asserts that every
 * known-indexed old URL hits a specific rule rather than the home-page catch-all, and that no target
 * is a content slug or draft tour that does not exist.
 *
 * One hop, always: every rule points at a final destination on the canonical host, so no visitor and
 * no crawler is ever chained through a second redirect.
 */

import { EXACT, PREFIXES, FR_PREFIX, isFrenchSource } from './map.js';

/**
 * Normalise an incoming path so the map only ever needs one spelling of each URL.
 * WordPress served lower-case paths with a trailing slash; the map is keyed WITHOUT the slash.
 * `/` normalises to '' (the empty key), which the map sends to the new home page.
 */
export function normalisePath(pathname) {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* malformed %-escape — match on the raw form rather than throwing a 500 at a crawler */
  }
  p = p
    .toLowerCase()
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '');
  return p === '/' ? '' : p;
}

/**
 * The canonical-site path an old path should land on. Exact match first, then the longest matching
 * prefix, then the home page — a request that matches nothing is still a valid page, never a 404.
 */
export function resolveTarget(path) {
  if (path in EXACT) return EXACT[path];
  let best = null;
  for (const [prefix, target] of PREFIXES) {
    if (
      (path === prefix || path.startsWith(`${prefix}/`)) &&
      (!best || prefix.length > best[0].length)
    ) {
      best = [prefix, target];
    }
  }
  return best ? best[1] : '/';
}

/**
 * Full destination URL. FR_PREFIX is '' until the canonical site makes French URL-addressable —
 * see the long comment in map.js. The home page never takes a prefix twice ('/fr' + '/' = '/fr').
 */
export function buildTarget(origin, path, target) {
  const prefix = isFrenchSource(path) ? FR_PREFIX : '';
  const p = prefix && target === '/' ? prefix : `${prefix}${target}`;
  return `${origin}${p}`;
}

/**
 * robots.txt is served here rather than redirected. During a domain move Google must be able to
 * crawl the old URLs to discover the 301s, and a redirected robots.txt is one more thing that can
 * go wrong at exactly the wrong moment. Allow everything, and point at the legacy sitemap below.
 */
function robotsTxt(host) {
  return `User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`;
}

/**
 * A sitemap of the OLD urls — every key in the map, on the legacy host. This looks backwards, but it
 * is the standard way to accelerate a domain move: it invites Google to recrawl precisely the URLs
 * that now 301, so the signals transfer in weeks rather than months. Retire it (and this handler)
 * once Search Console shows the old URLs consolidated — roughly a year after the cutover.
 */
const LEGACY_SITEMAPS = new Set([
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap.rss',
  '/page-sitemap.xml',
  '/post-sitemap.xml',
  '/article-sitemap.xml',
  '/category-sitemap.xml',
  '/language-sitemap.xml',
]);

function legacySitemap(host) {
  const urls = Object.keys(EXACT)
    .map((p) => `  <url><loc>https://${host}${p === '' ? '/' : p}/</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

const handler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = (env.CANONICAL_ORIGIN || 'https://bellemaretours.com').replace(/\/+$/, '');
    const path = normalisePath(url.pathname);

    // normalisePath lower-cases, so these also catch /Robots.txt and /Sitemap.xml.
    if (path === '/robots.txt') {
      return new Response(robotsTxt(url.hostname), {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'max-age=3600' },
      });
    }
    // All five filenames the old All-in-One-SEO install published, so a crawler holding any of them
    // still gets a live sitemap of the URLs that now redirect.
    if (LEGACY_SITEMAPS.has(path)) {
      return new Response(legacySitemap(url.hostname), {
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          'cache-control': 'max-age=3600',
        },
      });
    }

    const target = buildTarget(origin, path, resolveTarget(path));
    // Query is preserved so ad clicks, UTM tags and gclid survive the move; the old site's own
    // pagination/preview params are harmless on the destination.
    const location = `${target}${url.search}`;

    return new Response(null, {
      status: 301,
      headers: {
        location,
        // A permanent redirect that a browser caches forever is very hard to undo if a target turns
        // out wrong. An hour is long enough to spare the edge work, short enough to fix a mistake.
        'cache-control': 'max-age=3600',
      },
    });
  },
};

export default handler;
