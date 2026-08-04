import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EXACT, FR_PREFIX, PREFIXES } from '../../workers/redirect-legacy/src/map.js';
import { LOCALE_PREFIX } from '@/lib/i18n/routing';
import worker, {
  buildTarget,
  normalisePath,
  resolveTarget,
} from '../../workers/redirect-legacy/src/index.js';

/**
 * The visitemaurice.com → bellemaretours.com map is only worth anything if every target is a page
 * that actually exists. The whole point of a URL-level map (rather than bouncing the old domain at
 * the home page) is to inherit the old site's ranking signals — and a redirect onto a 404 inherits
 * nothing while looking, from the outside, like it worked.
 *
 * So this suite checks the map against the repo's real slug sources: the code-generated content
 * trees for blog/destinations, and the static routes under app/(site). Activity targets are checked
 * for SHAPE and against the known-draft list only — the catalogue lives in the database and this
 * suite must not depend on one. Whether a tour is still published is a live check, not a unit test.
 */

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([a-z]:)/i, '$1');

function slugsIn(file: string): Set<string> {
  const src = readFileSync(`${ROOT}${file}`, 'utf8');
  return new Set(
    Array.from(src.matchAll(/slug: '([a-z0-9-]+)'/g), (m) => m[1]).filter(
      (s): s is string => s !== undefined,
    ),
  );
}

const BLOG = slugsIn('src/lib/content/_blog.gen.ts');
const AREAS = slugsIn('src/lib/content/_areas.gen.ts');

/** Static routes that map targets are allowed to point at, taken from app/(site). */
const STATIC_ROUTES = new Set([
  '/',
  '/about',
  '/account',
  '/activities',
  '/airport-transfers',
  '/attractions',
  '/belle-mare-tours',
  '/blog',
  '/cart',
  '/checkout',
  '/contact',
  '/cookies',
  '/destinations',
  '/dolphin-swim-mauritius',
  '/help',
  '/ile-aux-cerfs-tours',
  '/mauritius-catamaran-cruise',
  '/mauritius-tours',
  '/mauritius-travel-guide',
  '/privacy',
  '/refunds',
  '/rent',
  '/reviews',
  '/terms',
  '/things-to-do-in-belle-mare',
]);

const targets: string[] = [
  ...Object.values(EXACT as Record<string, string>),
  ...(PREFIXES as [string, string][]).map(([, t]) => t),
];

describe('legacy redirect map — every target resolves to a real page', () => {
  it.each([...new Set(targets)])('%s is a known route', (target: string) => {
    if (target.startsWith('/blog/')) {
      expect(BLOG).toContain(target.slice('/blog/'.length));
    } else if (target.startsWith('/destinations/')) {
      expect(AREAS).toContain(target.slice('/destinations/'.length));
    } else if (target.startsWith('/activities/')) {
      // Slug shape only — the catalogue lives in the database, so existence is a release-time check.
      expect(target.slice('/activities/'.length)).toMatch(/^[a-z0-9-]+$/);
    } else {
      expect(STATIC_ROUTES).toContain(target);
    }
  });

  it('never points at a path that would itself redirect again', () => {
    // next.config.mjs 308s these to their canonical form; targeting them would cost a second hop.
    const chained = ['/mauritius-airport-transfers', '/mauritius-activities', '/airport-transfer'];
    for (const t of targets) expect(chained).not.toContain(t);
  });

  it('has no target that is an /activities draft slug known to be unpublished', () => {
    // `shopping-tour`, `chamarel-tour`, `cultural-north-tour`, `south-west-splendor-expedition` and
    // `tea-wildlife-exploration` were draft when the map was built — the map must use the published
    // twin (e.g. private-shopping-tour) instead.
    const drafts = [
      '/activities/shopping-tour',
      '/activities/chamarel-tour',
      '/activities/cultural-north-tour',
      '/activities/south-west-splendor-expedition',
      '/activities/tea-wildlife-exploration',
    ];
    for (const t of targets) expect(drafts).not.toContain(t);
  });
});

describe('legacy redirect map — coverage of the real indexed URL set', () => {
  // Paths the Worker answers itself (robots.txt + the eight old sitemap filenames), so they are
  // legitimately absent from the map.
  const SERVED_DIRECTLY = new Set([
    '/robots.txt',
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/sitemap.rss',
    '/page-sitemap.xml',
    '/post-sitemap.xml',
    '/article-sitemap.xml',
    '/category-sitemap.xml',
    '/language-sitemap.xml',
    '/llms.txt',
  ]);

  const inventory = readFileSync(`${ROOT}workers/redirect-legacy/legacy-urls.txt`, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  it('has an inventory to check against', () => {
    expect(inventory.length).toBeGreaterThan(150);
  });

  it('routes every indexed URL to a specific rule, never the home-page catch-all', () => {
    const unmapped = inventory
      .map((p) => normalisePath(p))
      .filter((p) => !SERVED_DIRECTLY.has(p) && !(p in EXACT));
    expect(unmapped).toEqual([]);
  });
});

describe('generated .htaccess stays in sync with the map', () => {
  // The Apache drop-in is what actually gets uploaded to the old host, so it drifting away from
  // map.js would mean the tests above are grading a file nobody deploys.
  const htaccess = readFileSync(`${ROOT}workers/redirect-legacy/apache/.htaccess`, 'utf8');

  it('emits a rule for every exact mapping', () => {
    const missing = Object.entries(EXACT as Record<string, string>)
      .filter(([from]) => from !== '')
      .filter(
        ([from, to]) =>
          !htaccess.includes(`^${from.replace(/^\//, '')}/?$ https://bellemaretours.com${to} `),
      )
      .map(([from]) => from);
    expect(missing).toEqual([]);
  });

  it('ends with a catch-all so nothing 404s', () => {
    expect(htaccess.trimEnd().endsWith('RewriteRule ^ https://bellemaretours.com/ [R=301,L]')).toBe(
      true,
    );
  });

  it('lets robots.txt and sitemap.xml through instead of redirecting them', () => {
    expect(htaccess).toContain('RewriteRule ^robots\\.txt$ - [L]');
    expect(htaccess).toContain('RewriteRule ^sitemap\\.xml$ - [L]');
  });

  it('serves the sitemap at all five legacy AIOSEO filenames, not a redirect', () => {
    // Search Console still holds these URLs; a 301 there is reported as a broken sitemap and the
    // recrawl that transfers the rankings never gets invited.
    expect(htaccess).toContain(
      'RewriteRule ^(page|post|article|category|language)-sitemap\\.xml$ /sitemap.xml [L]',
    );
    expect(htaccess).toContain('RewriteRule ^sitemap_index\\.xml$ /sitemap.xml [L]');
    expect(htaccess).toContain('RewriteRule ^sitemap\\.rss$ /sitemap.xml [L]');
  });

  it('orders longer sources first so a page always beats its section', () => {
    const rules = [...htaccess.matchAll(/^RewriteRule \^([^ ]+?)\/\?\$ /gm)].map(
      (m) => m[1]!.length,
    );
    expect(rules).toEqual([...rules].sort((a, b) => b - a));
  });
});

describe('normalisePath', () => {
  it('strips the trailing slash WordPress always served', () => {
    expect(normalisePath('/en/sightseeing/north-tour/')).toBe('/en/sightseeing/north-tour');
  });
  it('maps the root to the empty key', () => {
    expect(normalisePath('/')).toBe('');
  });
  it('lower-cases and collapses repeated slashes', () => {
    expect(normalisePath('/EN//Sightseeing/North-Tour/')).toBe('/en/sightseeing/north-tour');
  });
  it('survives a malformed percent-escape instead of throwing', () => {
    expect(() => normalisePath('/en/%E0%A4%A')).not.toThrow();
  });
});

describe('resolveTarget', () => {
  it('prefers an exact match', () => {
    expect(resolveTarget('/en/sightseeing/north-tour')).toBe('/activities/north-tour');
  });
  it('falls back to the longest matching prefix for an unmapped child', () => {
    expect(resolveTarget('/en/article/some-post-published-after-the-crawl')).toBe('/blog');
  });
  it('prefers the longer prefix when two match', () => {
    // Both '/en' and '/en/article' match; the article rule must win.
    expect(resolveTarget('/en/article/anything')).toBe('/blog');
  });
  it('sends an entirely unknown path to the home page, never a 404', () => {
    expect(resolveTarget('/wp-content/uploads/2024/03/header-lion-safari.jpg')).toBe('/');
  });
});

describe('buildTarget', () => {
  it('builds an absolute URL on the canonical origin', () => {
    expect(
      buildTarget(
        'https://bellemaretours.com',
        '/en/sightseeing/north-tour',
        '/activities/north-tour',
      ),
    ).toBe('https://bellemaretours.com/activities/north-tour');
  });
  it('sends a non-/en (French) source to the French URL', () => {
    expect(
      buildTarget('https://x.test', '/visites-guidees/le-nord', '/activities/north-tour'),
    ).toBe('https://x.test/fr/activities/north-tour');
  });

  it('sends an /en source to the unprefixed English URL', () => {
    expect(buildTarget('https://x.test', '/en/sightseeing/le-nord', '/activities/north-tour')).toBe(
      'https://x.test/activities/north-tour',
    );
  });

  // '/fr' + '/' would be '/fr/', which then 308s — the old French home page is the single most
  // linked URL on the retired domain, so it must land in one hop.
  it('sends the French home page to /fr with no trailing slash', () => {
    expect(buildTarget('https://x.test', '', '/')).toBe('https://x.test/fr');
  });

  it('keeps the English home page at the root', () => {
    expect(buildTarget('https://x.test', '/en', '/')).toBe('https://x.test/');
  });

  // The Worker and the app describe the same URL space from opposite sides of the domain move; if
  // one moves without the other, every French redirect silently lands on English again.
  it('agrees with the app about where French lives', () => {
    expect(FR_PREFIX).toBe(LOCALE_PREFIX.fr);
  });
});

describe('worker responses', () => {
  async function get(path: string) {
    return worker.fetch(new Request(`https://www.visitemaurice.com${path}`), {
      CANONICAL_ORIGIN: 'https://bellemaretours.com',
    });
  }

  it('301s a tour page straight to its new home, in one hop', async () => {
    const res = await get('/en/sightseeing/north-tour/');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://bellemaretours.com/activities/north-tour');
  });

  it('preserves the query string so ad clicks and UTM tags survive', async () => {
    const res = await get('/en/sightseeing/north-tour/?utm_source=google&gclid=abc');
    expect(res.headers.get('location')).toBe(
      'https://bellemaretours.com/activities/north-tour?utm_source=google&gclid=abc',
    );
  });

  it('serves robots.txt rather than redirecting it, so the 301s stay crawlable', async () => {
    const res = await get('/robots.txt');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Allow: /');
    expect(body).toContain('Sitemap: https://www.visitemaurice.com/sitemap.xml');
  });

  it('serves a sitemap of the OLD urls so Google recrawls them and finds the redirects', async () => {
    const res = await get('/sitemap.xml');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('https://www.visitemaurice.com/en/sightseeing/north-tour/');
    expect(res.headers.get('content-type')).toContain('application/xml');
  });

  it('does not cache the 301 forever — a wrong target must be fixable', async () => {
    const res = await get('/en/sightseeing/north-tour/');
    expect(res.headers.get('cache-control')).toBe('max-age=3600');
  });
});
