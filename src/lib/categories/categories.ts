/* Shared category list used by the navbar, search suggestions, home rails and filters.
 * Categories are managed in the `categories` table; this module also holds the static
 * fallback (the original seven) used when the table isn't reachable yet — e.g. before the
 * migration is applied — so the UI never breaks. */

export interface CategoryItem {
  name: string;
  slug: string;
  imageUrl?: string | null;
}

/** True for the sightseeing-tours category (live: "Private Sightseeing tours"; fallback:
 *  "Sightseeing tours"). These are the vehicle-priced private day tours the AI Trip Planner builds,
 *  so we surface a planner promo card at the top of their listing. */
export function isSightseeingCategory(name: string | null | undefined): boolean {
  return !!name && /sightseeing/i.test(name);
}

export const FALLBACK_CATEGORIES: CategoryItem[] = [
  { name: 'Catamaran cruises', slug: 'catamaran-cruises' },
  { name: 'Île aux Cerfs', slug: 'ile-aux-cerfs' },
  { name: 'Dolphin swims', slug: 'dolphin-swims' },
  { name: 'Sea walks & diving', slug: 'sea-walks-diving' },
  { name: 'Parasailing', slug: 'parasailing' },
  { name: 'Sightseeing tours', slug: 'sightseeing-tours' },
];
