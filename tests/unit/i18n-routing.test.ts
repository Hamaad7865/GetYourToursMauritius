import { describe, expect, it } from 'vitest';
import {
  LOCALE_PREFIX,
  hasLocalisedUrl,
  isEnglishOnly,
  localeAlternates,
  localiseHref,
  localePath,
  splitLocalePath,
} from '@/lib/i18n/routing';

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

/**
 * The legal pages render French chrome around an ENGLISH body plus a "this page is available in
 * English only" notice — deliberate, because the English text is the legally binding version. So
 * /fr/terms is not a French translation of /terms, it is the same document at a second URL.
 * Advertising it with hreflang="fr" claims a translation that does not exist: Google either drops
 * the unreciprocated annotation or treats the pair as duplicates, and audit tools flag it.
 */
describe('English-only pages', () => {
  it('knows which pages have no real translation', () => {
    expect(isEnglishOnly('/terms')).toBe(true);
    expect(isEnglishOnly('/privacy')).toBe(true);
    expect(isEnglishOnly('/refunds')).toBe(true);
  });

  // /cookies IS fully translated, so it must keep its pair — this guards against someone lumping
  // all four "legal-looking" pages together.
  it('does not treat the translated cookie policy as English-only', () => {
    expect(isEnglishOnly('/cookies')).toBe(false);
  });

  it('recognises the prefixed form too', () => {
    expect(isEnglishOnly('/fr/terms')).toBe(true);
  });

  it('emits no hreflang for an English-only page', () => {
    expect(localeAlternates('/terms', 'en').languages).toBeUndefined();
    expect(localeAlternates('/terms', 'fr').languages).toBeUndefined();
  });

  // The French URL stays reachable (a French visitor clicking Terms in the footer keeps French
  // chrome) but consolidates onto the English URL rather than competing with it.
  it('points the French URL of an English-only page at the English canonical', () => {
    expect(localeAlternates('/terms', 'fr').canonical).toBe('/terms');
    expect(localeAlternates('/privacy', 'fr').canonical).toBe('/privacy');
  });

  it('still pairs genuinely translated pages', () => {
    expect(localeAlternates('/cookies', 'fr')).toEqual({
      canonical: '/fr/cookies',
      languages: { en: '/cookies', fr: '/fr/cookies', 'x-default': '/cookies' },
    });
  });
});

describe('LOCALE_PREFIX', () => {
  it('keeps English at the root so existing URLs never move', () => {
    expect(LOCALE_PREFIX.en).toBe('');
    expect(LOCALE_PREFIX.fr).toBe('/fr');
  });
});

/**
 * `localiseHref` is what every public link runs through (src/components/site/LocaleLink.tsx). Before
 * it, a French page's links pointed at English URLs: 154 of 236 French pages had no internal link at
 * all (crawl, 2026-10-13). English output must stay byte-identical — that is every existing URL.
 */
describe('localiseHref', () => {
  it('returns English hrefs untouched, whatever they are', () => {
    for (const href of ['/', '/activities/seaplane', '/activities/', '/cart', '/fr/blog', '#top']) {
      expect(localiseHref('en', href)).toBe(href);
    }
  });

  it('prefixes a page link on a French page', () => {
    expect(localiseHref('fr', '/activities/seaplane')).toBe('/fr/activities/seaplane');
    expect(localiseHref('fr', '/rent')).toBe('/fr/rent');
    expect(localiseHref('fr', '/airport-transfers/lux-belle-mare')).toBe(
      '/fr/airport-transfers/lux-belle-mare',
    );
  });

  it('sends the home link to /fr with no trailing slash', () => {
    expect(localiseHref('fr', '/')).toBe('/fr');
  });

  // '/fr/?q=1' is 308-redirected by Next to '/fr?q=1' — a redirect on every search from the header.
  it('keeps the query and the hash, and puts the prefix before them', () => {
    expect(localiseHref('fr', '/?q=dolphin')).toBe('/fr?q=dolphin');
    expect(localiseHref('fr', '/activities?category=Air%20Activity')).toBe(
      '/fr/activities?category=Air%20Activity',
    );
    expect(localiseHref('fr', '/belle-mare#hotels')).toBe('/fr/belle-mare#hotels');
    expect(localiseHref('fr', '/activities/seaplane?adults=2#reviews')).toBe(
      '/fr/activities/seaplane?adults=2#reviews',
    );
  });

  it('leaves an href that already names a locale exactly as written', () => {
    expect(localiseHref('fr', '/fr/activities')).toBe('/fr/activities');
    expect(localiseHref('fr', '/fr')).toBe('/fr');
  });

  it('never touches a link that is not a page on this site', () => {
    for (const href of [
      'https://wa.me/23057290907',
      '//cdn.example.com/x.js',
      'mailto:info@bellemaretours.com',
      'tel:+23057290907',
      '#faq',
      'activities',
      '',
    ]) {
      expect(localiseHref('fr', href)).toBe(href);
    }
  });

  it('leaves the booking funnel, the account and the back office at their one URL', () => {
    for (const href of [
      '/cart',
      '/checkout',
      '/checkout?hold=abc',
      '/wishlist',
      '/account',
      '/account/bookings',
      '/bookings/BMT123',
      '/quotes/Q1',
      '/auth/callback',
      '/admin',
      '/admin/seo',
      '/api/img?u=x',
    ]) {
      expect(localiseHref('fr', href)).toBe(href);
    }
  });

  it('does not mistake a longer path for an excluded section', () => {
    expect(localiseHref('fr', '/cartography')).toBe('/fr/cartography');
    expect(localiseHref('fr', '/accounting-tips')).toBe('/fr/accounting-tips');
  });

  it('keeps the English-only legal pages on their English URL', () => {
    for (const href of ['/terms', '/privacy', '/refunds']) {
      expect(localiseHref('fr', href)).toBe(href);
    }
    // The cookie policy IS translated.
    expect(localiseHref('fr', '/cookies')).toBe('/fr/cookies');
  });

  it('does not prefix a file', () => {
    expect(localiseHref('fr', '/sitemap.xml')).toBe('/sitemap.xml');
    expect(localiseHref('fr', '/pricelists/quad.pdf')).toBe('/pricelists/quad.pdf');
  });
});

describe('hasLocalisedUrl', () => {
  it('agrees with the pages the sitemap publishes in both languages', () => {
    for (const path of [
      '/',
      '/activities',
      '/activities/north-tour',
      '/attractions/le-morne-brabant',
      '/blog/ile-aux-cerfs-guide',
      '/destinations/grand-baie',
      '/airport-transfers',
      '/mauritius-catamaran-cruise',
      '/rent',
      '/about',
      '/contact',
      '/help',
      '/reviews',
      '/cookies',
      '/ai-road-trip-planner',
    ]) {
      expect(hasLocalisedUrl(path), path).toBe(true);
    }
  });
});
