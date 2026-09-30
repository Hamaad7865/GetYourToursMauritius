import { afterEach, describe, expect, it } from 'vitest';
import robots from '../../app/robots';
import { isNoindexBuild } from '@/lib/seo/site';

/**
 * The sandbox site (a public *.pages.dev copy of the live site, built with NEXT_PUBLIC_SITE_NOINDEX)
 * must tell every crawler to stay out — otherwise it competes with the real domain in search. The
 * flip side matters just as much: production never sets the flag, so its robots.txt must be exactly
 * what it was.
 */
const KEY = 'NEXT_PUBLIC_SITE_NOINDEX';
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe('sandbox noindex switch', () => {
  it('is off unless explicitly set to "true"', () => {
    delete process.env[KEY];
    expect(isNoindexBuild()).toBe(false);
    process.env[KEY] = 'false';
    expect(isNoindexBuild()).toBe(false);
    process.env[KEY] = '1';
    expect(isNoindexBuild()).toBe(false);
    process.env[KEY] = '';
    expect(isNoindexBuild()).toBe(false);
    process.env[KEY] = 'true';
    expect(isNoindexBuild()).toBe(true);
  });

  it('a sandbox build disallows everything and advertises no sitemap', () => {
    process.env[KEY] = 'true';
    const out = robots();
    expect(out.rules).toEqual([{ userAgent: '*', disallow: '/' }]);
    expect(out.sitemap).toBeUndefined();
    expect(out.host).toBeUndefined();
  });

  it('production robots.txt is untouched: crawlable, private areas excluded, sitemap advertised', () => {
    delete process.env[KEY];
    const out = robots();
    expect(out.rules).toEqual([
      { userAgent: '*', allow: '/', disallow: ['/account', '/admin', '/api/'] },
    ]);
    expect(String(out.sitemap)).toMatch(/\/sitemap\.xml$/);
    expect(out.host).toBeTruthy();
  });
});
