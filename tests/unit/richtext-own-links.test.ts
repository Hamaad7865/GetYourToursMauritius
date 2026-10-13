import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/seo/site', () => ({ SITE: { url: 'https://bellemaretours.com' } }));

const { ownPath } = await import('@/components/content/RichText');

/**
 * A blog link typed in /admin as a full address of this site was rendered as an EXTERNAL link: plain
 * anchor, no language prefix. Three posts written that way sent French readers to English tour pages
 * (crawl, 2026-10-13). `ownPath` cuts such an address down to its path so it is linked like any
 * other internal page.
 */
describe('ownPath', () => {
  it('turns a full address of this site into its path, with or without www', () => {
    expect(ownPath('https://bellemaretours.com/activities/south-tour-mauritius')).toBe(
      '/activities/south-tour-mauritius',
    );
    expect(ownPath('https://www.bellemaretours.com/blog/x?a=1#top')).toBe('/blog/x?a=1#top');
    expect(ownPath('https://bellemaretours.com')).toBe('/');
    expect(ownPath('https://bellemaretours.com/')).toBe('/');
  });

  it('leaves every other link exactly as written', () => {
    for (const href of [
      '/activities/north-tour',
      'https://bellemaretours.com.evil.test/x',
      'https://www.tripadvisor.com/x',
      'http://bellemaretours.com/x',
      'mailto:info@bellemaretours.com',
      '#faq',
    ]) {
      expect(ownPath(href)).toBe(href);
    }
  });
});
