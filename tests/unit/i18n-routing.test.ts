import { describe, expect, it } from 'vitest';
import { LOCALE_PREFIX, localeAlternates, localePath, splitLocalePath } from '@/lib/i18n/routing';

/**
 * French is URL-addressable under /fr. These helpers are the single place that knows that, and they
 * are shared by the middleware (which strips the prefix), page metadata (which emits the hreflang
 * pair) and the sitemap. A bug here is an SEO bug that shows up weeks later in Search Console, so
 * the prefix boundary and the home-page shape are pinned explicitly.
 */
describe('splitLocalePath', () => {
  it('reads the locale off a prefixed path and returns the underlying route', () => {
    expect(splitLocalePath('/fr/activities')).toEqual({ locale: 'fr', path: '/activities' });
    expect(splitLocalePath('/fr/activities/north-tour')).toEqual({
      locale: 'fr',
      path: '/activities/north-tour',
    });
  });

  it('treats a bare and trailing-slash /fr as the French home page', () => {
    expect(splitLocalePath('/fr')).toEqual({ locale: 'fr', path: '/' });
    expect(splitLocalePath('/fr/')).toEqual({ locale: 'fr', path: '/' });
  });

  // The retired WordPress site linked everything WITH a trailing slash. If '/fr/activities/' kept
  // its slash the rewrite would hand Next '/activities/', which Next 308s to '/activities' — losing
  // the prefix and dumping a French visitor on the English page, the exact bug this work fixes.
  it('strips a trailing slash so a legacy-style French URL keeps its locale', () => {
    expect(splitLocalePath('/fr/activities/')).toEqual({ locale: 'fr', path: '/activities' });
    expect(splitLocalePath('/activities/')).toEqual({ locale: 'en', path: '/activities' });
  });

  it('defaults to English for unprefixed paths', () => {
    expect(splitLocalePath('/')).toEqual({ locale: 'en', path: '/' });
    expect(splitLocalePath('/activities')).toEqual({ locale: 'en', path: '/activities' });
  });

  // The prefix must match on a SEGMENT boundary. A plain startsWith('/fr') would eat these and
  // silently serve French at an English URL — /french-... is a plausible future content slug.
  it('does not match a path that merely starts with the letters fr', () => {
    expect(splitLocalePath('/french-riviera')).toEqual({ locale: 'en', path: '/french-riviera' });
    expect(splitLocalePath('/frangipani')).toEqual({ locale: 'en', path: '/frangipani' });
  });
});

describe('localePath', () => {
  it('leaves English paths untouched', () => {
    expect(localePath('en', '/activities')).toBe('/activities');
    expect(localePath('en', '/')).toBe('/');
  });

  it('prefixes French paths', () => {
    expect(localePath('fr', '/activities')).toBe('/fr/activities');
  });

  // '/fr' + '/' would give '/fr/', which then 308s to '/fr' — a needless redirect on the single most
  // linked French URL, and a mismatch between the sitemap entry and the canonical.
  it('renders the French home page as /fr with no trailing slash', () => {
    expect(localePath('fr', '/')).toBe('/fr');
  });

  it('round-trips with splitLocalePath', () => {
    for (const path of ['/', '/activities', '/blog/some-post', '/french-riviera']) {
      for (const locale of ['en', 'fr'] as const) {
        expect(splitLocalePath(localePath(locale, path))).toEqual({ locale, path });
      }
    }
  });

  it('never double-prefixes an already-prefixed path', () => {
    expect(localePath('fr', '/fr/activities')).toBe('/fr/activities');
    expect(localePath('en', '/fr/activities')).toBe('/activities');
  });
});

describe('localeAlternates', () => {
  it('points the canonical at the URL being rendered, not the English one', () => {
    expect(localeAlternates('/activities', 'en').canonical).toBe('/activities');
    expect(localeAlternates('/activities', 'fr').canonical).toBe('/fr/activities');
  });

  // Both pages must advertise the SAME pair, or Google discards the annotation as unreciprocated.
  it('advertises the same en/fr pair from both sides', () => {
    const en = localeAlternates('/activities', 'en');
    const fr = localeAlternates('/activities', 'fr');
    expect(en.languages).toEqual(fr.languages);
    expect(en.languages).toEqual({
      en: '/activities',
      fr: '/fr/activities',
      'x-default': '/activities',
    });
  });

  it('defaults to English when no locale is given', () => {
    expect(localeAlternates('/about').canonical).toBe('/about');
  });

  it('handles the home page', () => {
    expect(localeAlternates('/', 'fr')).toEqual({
      canonical: '/fr',
      languages: { en: '/', fr: '/fr', 'x-default': '/' },
    });
  });
});

describe('LOCALE_PREFIX', () => {
  it('keeps English at the root so existing URLs never move', () => {
    expect(LOCALE_PREFIX.en).toBe('');
    expect(LOCALE_PREFIX.fr).toBe('/fr');
  });
});
