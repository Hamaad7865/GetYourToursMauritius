/**
 * Generates the Apache drop-in that retires visitemaurice.com, from the SAME map the Worker uses.
 *
 *   node scripts/build-legacy-htaccess.mjs
 *
 * Writes three files into workers/redirect-legacy/apache/ — upload them to the web root of the old
 * hosting after deleting the WordPress files:
 *   .htaccess    the 301 rules
 *   robots.txt   allow-all + a pointer at the sitemap, so Google can crawl the old URLs and see the 301s
 *   sitemap.xml  the OLD urls, which is what invites that recrawl in the first place
 *
 * Why generate rather than hand-write: the map is 199 rules. Typed by hand into a .htaccess with no
 * tests, a single slip silently sends real traffic to the wrong page and nobody notices for months.
 * Generated from map.js it inherits tests/unit/legacy-redirects.test.ts — the same coverage check
 * that asserts every indexed old URL resolves to a page that exists.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { EXACT, PREFIXES } from '../workers/redirect-legacy/src/map.js';

const ORIGIN = 'https://bellemaretours.com';
const HOST = 'www.visitemaurice.com';
const OUT = new URL('../workers/redirect-legacy/apache/', import.meta.url);

/** Escape a literal path for use inside an Apache regex. */
const rx = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `.htaccess` patterns have the leading slash stripped by Apache. */
const strip = (p) => p.replace(/^\//, '');

const header = `# visitemaurice.com → bellemaretours.com
#
# GENERATED FILE — do not edit here. Edit workers/redirect-legacy/src/map.js and re-run:
#   node scripts/build-legacy-htaccess.mjs
#
# Upload to the web root of the old hosting AFTER deleting the WordPress files. Leaving WordPress
# installed keeps an ageing, public, patch-hungry application online for no reason; once these rules
# are in place nothing else needs to exist on that server.
#
# Rules are longest-first so a specific page always beats its section. Query strings are preserved
# automatically by RewriteRule, so ad clicks, utm tags and gclid survive the move.

RewriteEngine On

# Serve robots.txt and the sitemaps from disk rather than redirecting them. During a domain move a
# crawler has to be able to read them to discover the 301s.
RewriteRule ^robots\\.txt$ - [L]
RewriteRule ^sitemap\\.xml$ - [L]

# The old All-in-One-SEO install published five more sitemap filenames, and Search Console still has
# them on file. Serve sitemap.xml's contents at each (an INTERNAL rewrite, no [R]) so whichever one
# Google re-fetches returns the list of old URLs to recrawl, instead of a redirect it reports as a
# broken sitemap.
RewriteRule ^(page|post|article|category|language)-sitemap\\.xml$ /sitemap.xml [L]
RewriteRule ^sitemap_index\\.xml$ /sitemap.xml [L]
RewriteRule ^sitemap\\.rss$ /sitemap.xml [L]
`;

const lines = [header];

// Exact rules, longest source first so /en/article/x can never be shadowed by /en.
lines.push(
  '\n# ── Exact page rules ────────────────────────────────────────────────────────────────────\n',
);
const exact = Object.entries(EXACT)
  .filter(([from]) => from !== '')
  .sort((a, b) => b[0].length - a[0].length);
for (const [from, to] of exact) {
  lines.push(`RewriteRule ^${rx(strip(from))}/?$ ${ORIGIN}${to} [R=301,L,NC]\n`);
}

// Prefix fallbacks — anything published after the crawl, paginated archives, feeds.
lines.push(
  '\n# ── Section fallbacks (unmapped children, pagination, feeds) ────────────────────────────\n',
);
for (const [prefix, to] of [...PREFIXES].sort((a, b) => b[0].length - a[0].length)) {
  lines.push(`RewriteRule ^${rx(strip(prefix))}(/.*)?$ ${ORIGIN}${to} [R=301,L,NC]\n`);
}

// Home page, then everything else. A request that matches nothing is still a real page, never a 404.
lines.push(
  '\n# ── Home, then the catch-all ────────────────────────────────────────────────────────────\n',
);
lines.push(`RewriteRule ^$ ${ORIGIN}/ [R=301,L]\n`);
lines.push(`RewriteRule ^ ${ORIGIN}/ [R=301,L]\n`);

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('.htaccess', OUT), lines.join(''), 'utf8');

writeFileSync(
  new URL('robots.txt', OUT),
  `User-agent: *\nAllow: /\n\nSitemap: https://${HOST}/sitemap.xml\n`,
  'utf8',
);

const urls = Object.keys(EXACT)
  .map((p) => `  <url><loc>https://${HOST}${p === '' ? '/' : p}/</loc></url>`)
  .join('\n');
writeFileSync(
  new URL('sitemap.xml', OUT),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  'utf8',
);

console.log(
  `wrote ${exact.length} exact + ${PREFIXES.length} prefix rules to workers/redirect-legacy/apache/`,
);
