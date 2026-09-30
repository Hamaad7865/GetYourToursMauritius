import { describe, expect, it } from 'vitest';
import robots from '../../app/robots';
import { evaluateSandboxSurface } from '../../scripts/sandbox/ci.mjs';

/**
 * The post-deploy check reads the DEPLOYED site's own responses, so a build where the "don't index"
 * and "no analytics" switches silently did not take fails the run instead of publishing a crawlable
 * copy of the live site that reports into the live Google Analytics.
 */
const SANDBOX_ROBOTS = 'User-Agent: *\nDisallow: /\n';
const PRODUCTION_ROBOTS =
  'User-Agent: *\nAllow: /\nDisallow: /account\nDisallow: /admin\nDisallow: /api/\n\nHost: https://bellemaretours.com\nSitemap: https://bellemaretours.com/sitemap.xml\n';
const NOINDEX_PAGE =
  '<!DOCTYPE html><html><head><meta charSet="utf-8"/><meta name="robots" content="noindex, nofollow"/><title>Belle Mare Tours</title></head><body>hello</body></html>';
const INDEXABLE_PAGE =
  '<!DOCTYPE html><html><head><meta name="robots" content="index, follow"/></head><body>hello</body></html>';
const GTM_SNIPPET =
  '<script>j.src="https://www.googletagmanager.com/gtm.js?id="+i</script><noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXX"></iframe></noscript>';

describe('evaluateSandboxSurface', () => {
  it('passes a properly switched-off sandbox', () => {
    expect(
      evaluateSandboxSurface({
        robotsText: SANDBOX_ROBOTS,
        homeHtml: NOINDEX_PAGE,
        homeStatus: 200,
      }),
    ).toEqual([]);
  });

  it('accepts exactly what this app’s own robots() returns for a sandbox build', () => {
    process.env.NEXT_PUBLIC_SITE_NOINDEX = 'true';
    try {
      const rules = robots().rules as Array<{ userAgent: string; disallow: string }>;
      const text = rules
        .map((r) => `User-Agent: ${r.userAgent}\nDisallow: ${r.disallow}\n`)
        .join('\n');
      expect(
        evaluateSandboxSurface({ robotsText: text, homeHtml: NOINDEX_PAGE, homeStatus: 200 }),
      ).toEqual([]);
    } finally {
      delete process.env.NEXT_PUBLIC_SITE_NOINDEX;
    }
  });

  it('rejects a PRODUCTION-style robots.txt (crawlable, with a sitemap) — the switch did not take', () => {
    const fatal = evaluateSandboxSurface({
      robotsText: PRODUCTION_ROBOTS,
      homeHtml: NOINDEX_PAGE,
      homeStatus: 200,
    });
    expect(fatal.join('\n')).toMatch(/does not disallow everything/);
    expect(fatal.join('\n')).toMatch(/advertises a sitemap/);
  });

  it('rejects a page without a noindex robots meta tag', () => {
    const fatal = evaluateSandboxSurface({
      robotsText: SANDBOX_ROBOTS,
      homeHtml: INDEXABLE_PAGE,
      homeStatus: 200,
    });
    expect(fatal.join('\n')).toMatch(/no noindex robots meta/);
  });

  it('rejects a page that loads Google Tag Manager (test traffic would reach the live analytics)', () => {
    const fatal = evaluateSandboxSurface({
      robotsText: SANDBOX_ROBOTS,
      homeHtml: NOINDEX_PAGE.replace('hello', GTM_SNIPPET),
      homeStatus: 200,
    });
    expect(fatal.join('\n')).toMatch(/Google Tag Manager/);
  });

  it('rejects a home page that is not serving, without also piling on a misleading meta-tag error', () => {
    const fatal = evaluateSandboxSurface({
      robotsText: SANDBOX_ROBOTS,
      homeHtml: 'Internal error',
      homeStatus: 500,
    });
    expect(fatal).toEqual(['the home page returned HTTP 500, not 200']);
  });

  it('treats a missing robots.txt as a failure, not a pass', () => {
    const fatal = evaluateSandboxSurface({
      robotsText: '',
      homeHtml: NOINDEX_PAGE,
      homeStatus: 200,
    });
    expect(fatal.join('\n')).toMatch(/does not disallow everything/);
  });
});
