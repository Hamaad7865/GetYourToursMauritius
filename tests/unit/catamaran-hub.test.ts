import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Locale } from '@/lib/i18n/config';
import type { TourSummary } from '@/lib/validation/tours';

/* /mauritius-catamaran-cruise is the page meant to rank for "catamaran mauritius" (Oct 2026: Google
 * split the search between it and the homepage). These pin what the page is built from: every
 * catamaran we sell (the private ones live in a mixed category), live prices, FAQ text identical in
 * the accordion and the FAQPage JSON-LD, and same-language links on /fr. */

const localeRef = vi.hoisted(() => ({ current: 'en' as Locale }));

vi.mock('@/lib/i18n/server', () => ({
  getT: async () => (key: string) => key,
  getLocale: async () => localeRef.current,
}));
// Price is a client component bound to the visitor's currency; render the raw euro amount here.
vi.mock('@/components/site/Price', () => ({
  Price: ({ eur }: { eur: number }) => `€${eur}`,
}));

function tour(over: Partial<TourSummary>): TourSummary {
  return {
    id: over.slug ?? 'id',
    slug: 'x',
    type: 'activity',
    title: 'X',
    summary: null,
    category: 'Catamaran cruises',
    location: null,
    durationMinutes: 420,
    fromPriceEur: 100,
    fromPriceMaxGuests: null,
    fromPriceIncluded: null,
    pricingMode: 'per_person',
    minAdvanceDays: 1,
    ratingAvg: null,
    ratingCount: 0,
    heroImage: null,
    images: [],
    region: 'East',
    lat: null,
    lng: null,
    ...over,
  } as TourSummary;
}

const SHARED = [
  tour({ slug: 'catamaran-cruise-ile-aux-cerfs', title: 'Île aux Cerfs', fromPriceEur: 85 }),
  tour({
    slug: 'catamaran-sunset-cruise',
    title: 'Sunset Cruise',
    durationMinutes: 120,
    fromPriceEur: 45,
    region: 'North',
  }),
];
const PRIVATE_CRUISES = [
  tour({
    slug: 'private-full-day-catamaran-ile-aux-cerfs',
    title: 'Private Catamaran',
    category: 'Private Cruises',
    pricingMode: 'per_group',
    fromPriceEur: 700,
    fromPriceMaxGuests: 4,
  }),
  tour({
    slug: 'private-luxury-speedboat-5-island',
    title: 'Private Speedboat',
    category: 'Private Cruises',
    pricingMode: 'per_group',
    fromPriceEur: 300,
  }),
];

vi.mock('@/lib/seo/landing', () => ({
  featuredActivities: async ({ category }: { category?: string }) =>
    category === 'Private Cruises' ? PRIVATE_CRUISES : SHARED,
}));

const { default: CatamaranPage } = await import('../../app/(site)/mauritius-catamaran-cruise/page');
const { FaqAccordion } = await import('@/components/seo/LandingSections');
const { JsonLd } = await import('@/components/seo/JsonLd');
const { ReviewList } = await import('@/components/catalogue/ReviewList');
const { CatamaranComparison, catamaranPriceFacts } =
  await import('@/components/seo/CatamaranComparison');
const { categoryHref } = await import('@/lib/catalogue/category-hubs');
const { breadcrumbTrail } = await import('@/lib/catalogue/detail');
const { latestTopicReviews } = await import('@/lib/content/activity-reviews-pool');

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => !!n && typeof n === 'object' && 'type' in n && 'props' in n;
function findAll(node: unknown, target: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const c of node) findAll(c, target, out);
    return out;
  }
  if (!isEl(node)) return out;
  if (node.type === target) out.push(node);
  findAll(node.props?.children, target, out);
  return out;
}

async function page(locale: Locale) {
  localeRef.current = locale;
  return CatamaranPage();
}

function jsonLdOfType(tree: unknown, type: string) {
  return findAll(tree, JsonLd)
    .map((el) => el.props.data as Record<string, unknown>)
    .find((d) => d['@type'] === type);
}

describe('catamaran page', () => {
  it('lists every catamaran, including the private ones, but no speedboat', async () => {
    const tree = await page('en');
    const [table] = findAll(tree, CatamaranComparison);
    const slugs = (table!.props.activities as TourSummary[]).map((a) => a.slug);
    expect(slugs).toEqual([
      'catamaran-cruise-ile-aux-cerfs',
      'catamaran-sunset-cruise',
      'private-full-day-catamaran-ile-aux-cerfs',
    ]);
    const list = jsonLdOfType(tree, 'ItemList') as { itemListElement: unknown[] };
    expect(list.itemListElement).toHaveLength(3);
  });

  it('keeps the FAQ accordion and its JSON-LD identical, in both languages', async () => {
    for (const locale of ['en', 'fr'] as const) {
      const tree = await page(locale);
      const [accordion] = findAll(tree, FaqAccordion);
      const visible = accordion!.props.items as { q: string; a: string }[];
      const faq = jsonLdOfType(tree, 'FAQPage') as {
        mainEntity: { name: string; acceptedAnswer: { text: string } }[];
      };
      expect(faq.mainEntity.map((m) => ({ q: m.name, a: m.acceptedAnswer.text }))).toEqual(visible);
      expect(visible).toHaveLength(9);
      if (locale === 'fr') expect(visible.every((f) => f.q.endsWith(' ?'))).toBe(true);
    }
  });

  it('links French pages to French URLs', async () => {
    const tree = await page('fr');
    const list = jsonLdOfType(tree, 'ItemList') as {
      itemListElement: { url?: string; item?: string }[];
    };
    const urls = JSON.stringify(list.itemListElement);
    expect(urls).toContain('/fr/activities/catamaran-cruise-ile-aux-cerfs');
    const html = renderToStaticMarkup(
      createElement(CatamaranComparison, { activities: SHARED, locale: 'fr' }),
    );
    expect(html).toContain('href="/fr/activities/catamaran-sunset-cruise"');
    expect(html).toContain('Partagée, par personne');
  });

  it('quotes the newest reviews that are about a catamaran, under the honest topic rating', async () => {
    const tree = await page('en');
    const [reviews] = findAll(tree, ReviewList);
    const quoted = reviews!.props.reviews as { text: string }[];
    expect(quoted).toHaveLength(3);
    for (const r of quoted) {
      expect(r.text).toMatch(/\bcatamarans?\b|\bcruises?\b/i);
      expect(r.text).not.toMatch(/\bspeed ?boats?\b/i);
    }
    expect(reviews!.props.ratingCount).toBeGreaterThan(100);
  });
});

describe('catamaranPriceFacts', () => {
  it('finds the cheapest shared full day, shorter cruise and private boat', () => {
    const facts = catamaranPriceFacts([
      ...SHARED,
      tour({ slug: 'northern', fromPriceEur: 95, region: 'North', durationMinutes: 480 }),
      PRIVATE_CRUISES[0]!,
    ]);
    expect(facts.sharedFullDay).toEqual({ eur: 85 });
    expect(facts.sharedShort).toEqual({ eur: 45, title: 'Sunset Cruise' });
    expect(facts.privateBoat).toEqual({ eur: 700, guests: 4 });
  });

  it('reports nothing it cannot price', () => {
    expect(catamaranPriceFacts([tour({ fromPriceEur: null })])).toEqual({
      sharedFullDay: null,
      sharedShort: null,
      privateBoat: null,
    });
  });
});

describe('CatamaranComparison', () => {
  it('renders one row per cruise with its live from-price', () => {
    const html = renderToStaticMarkup(
      createElement(CatamaranComparison, {
        activities: [...SHARED, PRIVATE_CRUISES[0]!],
        locale: 'en',
      }),
    );
    expect(html.match(/<tr /g)).toHaveLength(3);
    expect(html).toContain('€85');
    expect(html).toContain('Private boat, up to 4 guests');
    expect(html).toContain('2 h');
  });
});

describe('category links', () => {
  it('send a category with a landing page there, and the rest to the filtered listing', () => {
    expect(categoryHref('Catamaran cruises')).toBe('/mauritius-catamaran-cruise');
    expect(categoryHref('Private Cruises')).toBe('/activities?category=Private%20Cruises');
  });

  it('make every catamaran tour’s breadcrumb point at the catamaran page', () => {
    const trail = breadcrumbTrail({ type: 'activity', category: 'Catamaran cruises' });
    expect(trail[2]).toEqual({ label: 'Catamaran cruises', href: '/mauritius-catamaran-cruise' });
  });
});

describe('latestTopicReviews', () => {
  it('returns the newest reviews first', () => {
    const reviews = latestTopicReviews({ category: 'Catamaran cruises' }, 5);
    expect(reviews).toHaveLength(5);
    const dates = reviews.map((r) => r.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
