/**
 * Categories that have their own landing page, and where a category link should go.
 *
 * A link to `/activities?category=X` canonicalises to `/activities`, so the header menu, the homepage
 * showcase and every tour's breadcrumb were handing their "Catamaran cruises" links to the generic
 * listing instead of /mauritius-catamaran-cruise — Search Console (Oct 2026) had Google split
 * "catamaran mauritius" between the homepage (#3–10) and that page (#19–21). Pointing every category
 * link at the landing page tells Google which page answers the search.
 *
 * Only categories whose landing page lists exactly that kind of tour belong here. "Private Cruises"
 * mixes catamarans, speedboats and dolphin trips, so it keeps the filtered listing.
 *
 * Client-safe and dependency-free: the header menu imports it.
 */
export const CATEGORY_HUBS: Readonly<Record<string, string>> = {
  'Catamaran cruises': '/mauritius-catamaran-cruise',
  // Names from FALLBACK_CATEGORIES (src/lib/categories/categories.ts), which the server-rendered menu
  // shows until the live list loads. No live category carries them, so their filtered listings are
  // empty — their landing pages are not.
  'Dolphin swims': '/dolphin-swim-mauritius',
  'Île aux Cerfs': '/ile-aux-cerfs-tours',
};

/** The URL a link to `category` should use: its landing page, else the filtered activity listing. */
export function categoryHref(category: string): string {
  return CATEGORY_HUBS[category] ?? `/activities?category=${encodeURIComponent(category)}`;
}
