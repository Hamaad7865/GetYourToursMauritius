import { describe, expect, it } from 'vitest';
import {
  breadcrumbJsonLd,
  breadcrumbTrail,
  buildFaq,
  durationLabel,
  initials,
  lineTotalEur,
  quickFacts,
  ratingBreakdown,
  relatedActivities,
} from '@/lib/catalogue/detail';
import { browseQueryString, parseBrowseParams } from '@/lib/catalogue/browse';
import type { Review, TourDetail, TourSummary } from '@/lib/validation/tours';
import { SITE } from '@/lib/seo/site';

function summary(overrides: Partial<TourSummary> = {}): TourSummary {
  return {
    id: 'a1',
    slug: 'catamaran-bbq',
    type: 'activity',
    title: 'Catamaran Cruise with BBQ',
    summary: 'A full day on the water',
    category: 'Catamaran cruises',
    location: 'Belle Mare',
    durationMinutes: 480,
    fromPriceEur: 75,
    ratingAvg: 4.8,
    ratingCount: 1158,
    heroImage: null,
    images: [],
    ...overrides,
  };
}

function detail(overrides: Partial<TourDetail> = {}): TourDetail {
  return {
    ...summary(),
    description: 'Para one.\n\nPara two.',
    meetingPoint: 'Belle Mare public beach jetty',
    pickupAvailable: true,
    languages: ['English', 'French'],
    inclusions: ['BBQ lunch', 'Snorkelling gear'],
    exclusions: ['Gratuities'],
    highlights: ['Île aux Cerfs', 'Waterfall stop'],
    cancellationPolicy: 'Free cancellation up to 24 hours before.',
    seoTitle: null,
    seoDescription: null,
    extra: {},
    images: [],
    options: [
      {
        id: 'o1',
        name: 'Shared cruise',
        description: null,
        prices: [
          { id: 'p1', label: 'Adult', amountEur: 75, maxGuests: null },
          { id: 'p2', label: 'Child', amountEur: 45, maxGuests: null },
        ],
      },
    ],
    translations: {},
    reviews: [],
    ...overrides,
  };
}

describe('durationLabel', () => {
  it('formats minutes and hours', () => {
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(60)).toBe('1 h');
    expect(durationLabel(90)).toBe('1.5 h');
    expect(durationLabel(480)).toBe('8 h');
  });
});

describe('breadcrumbTrail', () => {
  it('routes activities and transport to the right section', () => {
    expect(breadcrumbTrail({ type: 'activity', category: 'Catamaran cruises' })[1]).toEqual({
      label: 'Activities',
      href: '/activities',
    });
    const transport = breadcrumbTrail({ type: 'transport', category: 'Airport transfers' });
    expect(transport[1]).toEqual({ label: 'Transfers', href: '/activities?type=transport' });
    expect(transport[2]!.href).toBe('/activities?category=Airport%20transfers');
  });
});

describe('quickFacts', () => {
  it('derives facts from real fields and caps at six', () => {
    const facts = quickFacts(detail());
    expect(facts.length).toBeLessThanOrEqual(6);
    const labels = facts.map((f) => f.label);
    expect(labels).toContain('Duration');
    expect(labels).toContain('Live guide');
    expect(labels).toContain('Hotel pickup');
    expect(labels).toContain('Free cancellation');
  });

  it('falls back to the meeting point when there is no pickup', () => {
    const facts = quickFacts(detail({ pickupAvailable: false }));
    const meeting = facts.find((f) => f.label === 'Meeting point');
    expect(meeting?.sub).toBe('Belle Mare public beach jetty');
  });
});

describe('buildFaq', () => {
  it('includes the cancellation policy and a pickup answer when applicable', () => {
    const faqs = buildFaq(detail());
    expect(faqs[0]!.q).toMatch(/cancellation/i);
    expect(faqs.some((f) => /pickup/i.test(f.q))).toBe(true);
    expect(faqs.some((f) => /languages/i.test(f.q))).toBe(true);
  });

  it('asks where we meet when pickup is unavailable', () => {
    const faqs = buildFaq(detail({ pickupAvailable: false }));
    expect(faqs.some((f) => /where do we meet/i.test(f.q))).toBe(true);
  });

  it('omits the cancellation question when there is no policy', () => {
    const faqs = buildFaq(detail({ cancellationPolicy: null }));
    expect(faqs.some((f) => /cancellation policy/i.test(f.q))).toBe(false);
  });
});

describe('ratingBreakdown', () => {
  it('buckets reviews 5→1 with widths relative to the mode', () => {
    const reviews: Review[] = [
      { id: '1', author: 'A', rating: 5, text: null, createdAt: '2026-01-01' },
      { id: '2', author: 'B', rating: 5, text: null, createdAt: '2026-01-02' },
      { id: '3', author: 'C', rating: 4, text: null, createdAt: '2026-01-03' },
    ];
    const bars = ratingBreakdown(reviews);
    expect(bars.map((b) => b.stars)).toEqual([5, 4, 3, 2, 1]);
    expect(bars[0]!.count).toBe(2);
    expect(bars[0]!.widthPct).toBe(100);
    expect(bars[1]!.widthPct).toBe(50);
  });

  it('is safe with no reviews', () => {
    const bars = ratingBreakdown([]);
    expect(bars).toHaveLength(5);
    expect(bars.every((b) => b.count === 0 && b.widthPct === 0)).toBe(true);
  });
});

describe('relatedActivities', () => {
  it('excludes the current activity and respects the limit', () => {
    const candidates = [
      summary({ id: '1', slug: 'a' }),
      summary({ id: '2', slug: 'catamaran-bbq' }),
      summary({ id: '3', slug: 'c' }),
      summary({ id: '4', slug: 'd' }),
    ];
    const related = relatedActivities(candidates, 'catamaran-bbq', 2);
    expect(related).toHaveLength(2);
    expect(related.some((r) => r.slug === 'catamaran-bbq')).toBe(false);
  });
});

describe('lineTotalEur', () => {
  it('multiplies and rounds to cents', () => {
    expect(lineTotalEur(75, 2)).toBe(150);
    expect(lineTotalEur(45.5, 3)).toBe(136.5);
    expect(lineTotalEur(33.33, 3)).toBe(99.99);
  });
});

describe('initials', () => {
  it('derives one or two letters', () => {
    expect(initials('Priya Ramgoolam')).toBe('PR');
    expect(initials('Léa')).toBe('LÉ');
    expect(initials('  ')).toBe('?');
  });
});

describe('breadcrumbJsonLd', () => {
  it('emits an ordered BreadcrumbList of absolute URLs ending at the activity', () => {
    const json = breadcrumbJsonLd(detail());
    expect(json['@type']).toBe('BreadcrumbList');
    const items = json.itemListElement as Array<{ position: number; name: string; item: string }>;
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ position: 1, name: 'Home', item: `${SITE.url}/` });
    expect(items[3]!.name).toBe('Catamaran Cruise with BBQ');
    expect(items[3]!.item).toBe(`${SITE.url}/activities/catamaran-bbq`);
  });
});

describe('parseBrowseParams', () => {
  it('keeps valid filters and drops unknown ones', () => {
    const parsed = parseBrowseParams({
      category: 'Catamaran cruises',
      type: 'activity',
      q: '  dolphin  ',
      page: '3',
    });
    expect(parsed).toEqual({
      category: 'Catamaran cruises',
      type: 'activity',
      q: 'dolphin',
      page: 3,
    });
  });

  it('keeps any non-empty category (dynamic), drops an invalid type, clamps page to ≥ 1', () => {
    // Categories are now user-managed, so an unknown name is accepted (it simply matches no
    // activities) rather than being silently dropped. Type is still a fixed enum.
    const parsed = parseBrowseParams({ category: 'Nope', type: 'boat', page: '0' });
    expect(parsed.category).toBe('Nope');
    expect(parsed.type).toBeUndefined();
    expect(parsed.page).toBe(1);
  });

  it('treats a blank search as no search and takes the first array value', () => {
    expect(parseBrowseParams({ q: '   ' }).q).toBeUndefined();
    expect(parseBrowseParams({ category: ['Dolphin swims', 'x'] }).category).toBe('Dolphin swims');
  });
});

describe('browseQueryString', () => {
  it('serialises filters and omits page 1 / empties', () => {
    expect(browseQueryString({})).toBe('');
    expect(browseQueryString({ page: 1 })).toBe('');
    expect(browseQueryString({ category: 'Île aux Cerfs', page: 2 })).toBe(
      '?category=%C3%8Ele+aux+Cerfs&page=2',
    );
    expect(browseQueryString({ q: 'bbq', type: 'activity' })).toBe('?q=bbq&type=activity');
  });
});
