import type { TourDetail, TourSummary } from '@/lib/validation/tours';
import { SITE } from './site';

/**
 * Serialises JSON-LD for safe embedding in a <script> tag. Escapes `<` so a value
 * containing `</script>` (or `<!--`) cannot break out of the tag (stored XSS).
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Site-wide TravelAgency / LocalBusiness entity for Belle Mare Tours. */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    '@id': `${SITE.url}/#operator`,
    name: SITE.operator,
    alternateName: SITE.alternateName,
    url: SITE.url,
    image: `${SITE.url}/og-belle-mare.jpg`,
    telephone: SITE.phone,
    priceRange: SITE.priceRange,
    areaServed: 'Mauritius',
    knowsLanguage: [...SITE.languages],
    address: {
      '@type': 'PostalAddress',
      streetAddress: SITE.street,
      addressLocality: SITE.locality,
      addressRegion: SITE.region,
      addressCountry: SITE.country,
    },
    geo: { '@type': 'GeoCoordinates', latitude: SITE.geo.lat, longitude: SITE.geo.lng },
  };
}

/** Product + Offer (EUR) + AggregateRating for an activity detail page. */
export function productJsonLd(activity: TourDetail | TourSummary): Record<string, unknown> {
  const summary = 'summary' in activity ? activity.summary : null;
  const description = 'description' in activity ? activity.description : null;
  const json: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: activity.title,
    category: activity.category,
    brand: { '@type': 'Brand', name: SITE.operator },
  };
  const desc = description ?? summary;
  if (desc) json.description = desc;
  if (activity.fromPriceEur != null) {
    json.offers = {
      '@type': 'Offer',
      price: String(activity.fromPriceEur),
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: `${SITE.url}/activities/${activity.slug}`,
    };
  }
  if (activity.ratingAvg != null && activity.ratingCount > 0) {
    json.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: String(activity.ratingAvg),
      reviewCount: String(activity.ratingCount),
    };
  }
  return json;
}
