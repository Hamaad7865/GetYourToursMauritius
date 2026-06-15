/* Shared category list used by the navbar, search suggestions, home rails and filters.
 * Categories are managed in the `categories` table; this module also holds the static
 * fallback (the original seven) used when the table isn't reachable yet — e.g. before the
 * migration is applied — so the UI never breaks. */

export interface CategoryItem {
  name: string;
  slug: string;
  imageUrl?: string | null;
}

export const FALLBACK_CATEGORIES: CategoryItem[] = [
  { name: 'Catamaran cruises', slug: 'catamaran-cruises' },
  { name: 'Île aux Cerfs', slug: 'ile-aux-cerfs' },
  { name: 'Dolphin swims', slug: 'dolphin-swims' },
  { name: 'Sea walks & diving', slug: 'sea-walks-diving' },
  { name: 'Parasailing', slug: 'parasailing' },
  { name: 'Island tours', slug: 'island-tours' },
  { name: 'Airport transfers', slug: 'airport-transfers' },
];
