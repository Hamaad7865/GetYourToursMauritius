import { describe, expect, it } from 'vitest';
import { organizationJsonLd, productJsonLd, serializeJsonLd } from '@/lib/seo/jsonld';
import type { TourSummary } from '@/lib/validation/tours';

const base: TourSummary = {
  id: '1',
  slug: 'catamaran-bbq',
  type: 'activity',
  title: 'Catamaran Cruise with BBQ',
  summary: 'A full day on the water',
  category: 'Catamaran cruises',
  location: 'Belle Mare',
  durationMinutes: 480,
  fromPriceEur: 75,
  pricingMode: 'per_person',
  minAdvanceDays: 1,
  ratingAvg: 4.8,
  ratingCount: 1158,
  heroImage: null,
  images: [],
};

describe('JSON-LD', () => {
  it('builds the site-wide TravelAgency entity', () => {
    const org = organizationJsonLd();
    expect(org['@type']).toBe('TravelAgency');
    expect(org.name).toBe('Belle Mare Tours');
    expect(org.alternateName).toBe('GetYourToursMauritius');
    expect(org.knowsLanguage).toEqual(['en', 'fr']);
  });

  it('builds Product with Offer (EUR) + AggregateRating when present', () => {
    const p = productJsonLd(base);
    expect(p['@type']).toBe('Product');
    expect(p.offers).toMatchObject({ price: '75', priceCurrency: 'EUR' });
    expect(p.aggregateRating).toMatchObject({ ratingValue: '4.8', reviewCount: '1158' });
  });

  it('omits Offer and rating when not published', () => {
    const p = productJsonLd({ ...base, fromPriceEur: null, ratingAvg: null, ratingCount: 0 });
    expect(p.offers).toBeUndefined();
    expect(p.aggregateRating).toBeUndefined();
  });

  it('escapes </script> so JSON-LD cannot break out of the tag (XSS)', () => {
    const out = serializeJsonLd(
      productJsonLd({ ...base, title: 'Cruise </script><script>alert(1)</script>' }),
    );
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c/script>');
  });
});
