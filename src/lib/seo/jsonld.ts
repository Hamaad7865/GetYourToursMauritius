import type { TourDetail, TourSummary } from '@/lib/validation/tours';
import type { PlannerPlace } from '@/lib/validation/planner';
import { activityFromPriceEur } from '@/lib/catalogue/options';
import { SITE, SAME_AS } from './site';

/** The operator's postal address. Shared so every LocalBusiness node we emit carries the SAME one —
 *  `address` is REQUIRED on LocalBusiness (and TravelAgency is a subtype), and a node that declares
 *  the type without it is reported as invalid markup. */
function postalAddress(): Record<string, unknown> {
  return {
    '@type': 'PostalAddress',
    streetAddress: SITE.street,
    addressLocality: SITE.locality,
    addressRegion: SITE.region,
    addressCountry: SITE.country,
  };
}

/**
 * Serialises JSON-LD for safe embedding in a <script> tag. Escapes `<` so a value
 * containing `</script>` (or `<!--`) cannot break out of the tag (stored XSS).
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Absolutize a possibly-relative image/URL against the site origin — schema.org wants absolute URLs. */
function absoluteUrl(u: string): string {
  if (u.startsWith('http')) return u;
  return `${SITE.url}${u.startsWith('/') ? '' : '/'}${u}`;
}

/** A rolling ~1-year `priceValidUntil` (YYYY-MM-DD) so Offer rich results don't warn on a missing field. */
function priceValidUntil(): string {
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Site-wide TravelAgency / LocalBusiness entity for Belle Mare Tours. */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    '@id': `${SITE.url}/#operator`,
    name: SITE.operator,
    legalName: SITE.legalName,
    url: SITE.url,
    image: `${SITE.url}/hero-mauritius.jpg`,
    logo: `${SITE.url}/logo.png`,
    telephone: SITE.phone,
    priceRange: SITE.priceRange,
    areaServed: 'Mauritius',
    knowsLanguage: [...SITE.languages],
    // Corroborating profiles for the same entity. Our brand name is also a place name, so this is the
    // signal that tells Google "Belle Mare Tours" is a BUSINESS at this URL and not just the village.
    sameAs: [...SAME_AS],
    address: postalAddress(),
    geo: { '@type': 'GeoCoordinates', latitude: SITE.geo.lat, longitude: SITE.geo.lng },
    // NOTE: no site-wide aggregateRating here. A self-serving Organization rating injected on every page
    // (with no review on the page) is a Google review-snippet policy violation. The real 4.8/1,076 lives
    // on /reviews via reviewsPageJsonLd, where it's paired with the actual displayed reviews.
  };
}

/**
 * The `WebSite` entity for the brand name itself.
 *
 * `organizationJsonLd` above describes the BUSINESS; this describes the SITE, and it is the node
 * Google leans on to decide which URL is a brand's home. That distinction matters here because
 * "Belle Mare Tours" collides with the place name, and several of our own pages are plausible
 * answers for it (`/things-to-do-in-belle-mare`, `/belle-mare-tours`, `/belle-mare`) —
 * on a young domain Google's pick between them is unstable and has flipped day to day.
 *
 * `publisher` ties the site back to the TravelAgency `@id`, so the two nodes read as one entity
 * rather than two unrelated things that happen to share a name.
 *
 * A supporting signal, not a lever: which page wins a brand query is still decided mostly by links
 * and authority. This removes our own ambiguity; it does not overrule Google.
 */
export function websiteJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE.url}/#website`,
    url: SITE.url,
    name: SITE.name,
    // How people actually type it — both are real queries in Search Console.
    alternateName: ['Belle Mare Tours Mauritius', 'bellemaretours.com'],
    description: SITE.description,
    inLanguage: 'en',
    publisher: { '@id': `${SITE.url}/#operator` },
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
  // image is required for the Product/Offer rich result (price + rating snippet). Absolutize it.
  const img = activity.heroImage?.url ?? activity.images?.[0]?.url ?? null;
  if (img) json.image = absoluteUrl(img);
  const desc = description ?? summary;
  if (desc) json.description = desc;
  // Use the SAME from-price the page renders, not the raw column. A PRIVATE-ONLY activity has no
  // per-person tier rows, so the server-derived `fromPriceEur` is null and `offers` was dropped —
  // leaving a Product with no offers/rating/review at all, which Google reports as invalid markup
  // (it flagged 10 private tours). `activityFromPriceEur` falls back to the cheapest private base,
  // exactly as the card and detail page do, so the schema and the visible price cannot disagree.
  const fromPrice = activityFromPriceEur({
    fromPriceEur: activity.fromPriceEur,
    options: 'options' in activity ? activity.options : [],
  });
  if (fromPrice != null) {
    json.offers = {
      '@type': 'Offer',
      price: String(fromPrice),
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      priceValidUntil: priceValidUntil(),
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

/** Generic BreadcrumbList from ordered crumbs (paths are site-relative). */
export function breadcrumbListJsonLd(
  items: { name: string; path: string }[],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${SITE.url}${it.path}`,
    })),
  };
}

/** FAQPage from question/answer pairs (rich-result eligible). */
export function faqPageJsonLd(faqs: { q: string; a: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/** TouristAttraction entity for an attraction detail page. */
export function attractionJsonLd(
  place: PlannerPlace,
  opts: { path: string; image?: string | null },
): Record<string, unknown> {
  const json: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: place.name,
    url: `${SITE.url}${opts.path}`,
    address: {
      '@type': 'PostalAddress',
      addressRegion: `${place.region} Mauritius`,
      addressCountry: 'MU',
    },
    geo: { '@type': 'GeoCoordinates', latitude: place.lat, longitude: place.lng },
    isAccessibleForFree: true,
  };
  if (place.blurb) json.description = place.blurb;
  if (opts.image) json.image = absoluteUrl(opts.image);
  return json;
}

/** ItemList for a collection / hub page. */
export function itemListJsonLd(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: `${SITE.url}${it.path}`,
    })),
  };
}

/** Service (airport transfer) for a per-hotel transfer landing page. */
export function transferServiceJsonLd(opts: {
  name: string;
  description: string;
  path: string;
  area: string;
  fromPriceEur: number;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: 'Airport transfer',
    name: opts.name,
    description: opts.description,
    url: `${SITE.url}${opts.path}`,
    // A pure @id node REFERENCE, not a re-declaration. Repeating `'@type': 'TravelAgency'` here
    // minted a second LocalBusiness node carrying only a name — no address — which validators
    // report as invalid (it was the cause of the /airport-transfers and /rent errors). The bare
    // @id points at the full entity from organizationJsonLd, address and all.
    provider: { '@id': `${SITE.url}/#operator` },
    areaServed: { '@type': 'Place', name: `${opts.area}, Mauritius` },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      price: String(opts.fromPriceEur),
      url: `${SITE.url}${opts.path}`,
      availability: 'https://schema.org/InStock',
      priceValidUntil: priceValidUntil(),
    },
  };
}

/** Generic Service entity (car rental, private taxi, …) tied to the site operator. `serviceType` is the
 *  schema.org free-text label that broadens semantic coverage for the query the page serves. */
export function serviceJsonLd(opts: {
  serviceType: string;
  name: string;
  description: string;
  path: string;
  areaServed?: string;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: opts.serviceType,
    name: opts.name,
    description: opts.description,
    url: `${SITE.url}${opts.path}`,
    // A pure @id node REFERENCE, not a re-declaration. Repeating `'@type': 'TravelAgency'` here
    // minted a second LocalBusiness node carrying only a name — no address — which validators
    // report as invalid (it was the cause of the /airport-transfers and /rent errors). The bare
    // @id points at the full entity from organizationJsonLd, address and all.
    provider: { '@id': `${SITE.url}/#operator` },
    areaServed: { '@type': 'Place', name: opts.areaServed ?? 'Mauritius' },
  };
}

/** BlogPosting for a blog article. */
export function articleJsonLd(opts: {
  title: string;
  description: string;
  path: string;
  datePublished: string;
  image?: string | null;
}): Record<string, unknown> {
  const json: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: opts.title,
    description: opts.description,
    url: `${SITE.url}${opts.path}`,
    mainEntityOfPage: `${SITE.url}${opts.path}`,
    datePublished: opts.datePublished,
    dateModified: opts.datePublished,
    author: { '@type': 'Organization', name: SITE.operator, url: SITE.url },
    publisher: {
      '@type': 'Organization',
      name: SITE.operator,
      logo: { '@type': 'ImageObject', url: `${SITE.url}/logo.png` },
    },
  };
  // Absolutize: blog heroes are site-relative ('/blog/x.webp'), and schema.org/Google ignore a
  // relative image — which would silently cost the article its rich-result thumbnail.
  if (opts.image) json.image = absoluteUrl(opts.image);
  return json;
}

/** TravelAgency (same @id as the global Organization) enriched with displayed reviews. */
export function reviewsPageJsonLd(
  stats: { average: number; total: number },
  reviews: { author: string; rating: number; text: string; date: string | null }[],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    '@id': `${SITE.url}/#operator`,
    name: SITE.operator,
    url: SITE.url,
    // Same @id as organizationJsonLd, so Google merges the two into one entity — the profiles must
    // match or the merged entity carries whichever it saw last.
    sameAs: [...SAME_AS],
    // Required on LocalBusiness (TravelAgency is one). Validators check each block on its own and do
    // NOT credit the merged entity's address, so omitting it here reported /reviews as invalid.
    address: postalAddress(),
    telephone: SITE.phone,
    // From the generated stats, not a literal — a re-scrape must not silently desync the schema
    // from the numbers the page displays.
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: String(stats.average),
      reviewCount: String(stats.total),
      bestRating: '5',
    },
    review: reviews.map((r) => ({
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: String(r.rating), bestRating: '5' },
      author: { '@type': 'Person', name: r.author },
      reviewBody: r.text,
      ...(r.date ? { datePublished: r.date } : {}),
    })),
  };
}

/** TouristDestination for an area / destination guide page. */
export function destinationJsonLd(opts: {
  name: string;
  description: string;
  path: string;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'TouristDestination',
    name: `${opts.name}, Mauritius`,
    description: opts.description,
    url: `${SITE.url}${opts.path}`,
    address: { '@type': 'PostalAddress', addressRegion: 'Mauritius', addressCountry: 'MU' },
  };
}
