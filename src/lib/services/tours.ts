import type { ServiceContext } from './context';
import type { SearchToursQuery, TourDetail, TourSummary } from '@/lib/validation/tours';
import { NotImplementedError } from './errors';

export interface Paginated<T> {
  items: T[];
  total: number;
}

/**
 * Phase 0 stub data so the catalogue endpoint returns a real, typed, paginated
 * envelope before the database exists. Replaced by live Supabase queries in
 * Phase 2; the function signature is final.
 */
const SEED_PREVIEW: readonly TourSummary[] = [
  {
    id: 'preview-catamaran',
    slug: 'ile-aux-cerfs-catamaran-cruise-bbq',
    type: 'activity',
    title: 'Île aux Cerfs Catamaran Cruise with BBQ & Snorkeling',
    summary: 'Full-day catamaran cruise to Île aux Cerfs with snorkeling and an island BBQ lunch.',
    category: 'Catamaran cruises',
    location: 'Belle Mare',
    durationMinutes: 480,
    fromPriceEur: 75,
    ratingAvg: 4.8,
    ratingCount: 1158,
    heroImage: null,
  },
  {
    id: 'preview-south-tour',
    slug: 'private-south-tour-with-pickup',
    type: 'activity',
    title: 'Private South Tour with Pickup',
    summary: 'Private guided day tour of southern Mauritius with hotel pickup.',
    category: 'Island tours',
    location: 'South Mauritius',
    durationMinutes: 540,
    fromPriceEur: 110,
    ratingAvg: 4.9,
    ratingCount: 1158,
    heroImage: null,
  },
];

export async function searchTours(
  _ctx: ServiceContext,
  query: SearchToursQuery,
): Promise<Paginated<TourSummary>> {
  // Phase 0: in-memory filter over canned preview data. Phase 2 swaps this for a
  // PostgREST query (with the same return shape).
  let items: TourSummary[] = [...SEED_PREVIEW];

  if (query.category) {
    items = items.filter((tour) => tour.category === query.category);
  }
  if (query.type) {
    items = items.filter((tour) => tour.type === query.type);
  }
  if (query.q) {
    const needle = query.q.toLowerCase();
    items = items.filter(
      (tour) =>
        tour.title.toLowerCase().includes(needle) ||
        (tour.summary?.toLowerCase().includes(needle) ?? false),
    );
  }

  const total = items.length;
  const start = (query.page - 1) * query.pageSize;
  const paged = items.slice(start, start + query.pageSize);
  return { items: paged, total };
}

export async function getTour(_ctx: ServiceContext, slug: string): Promise<TourDetail> {
  // Implemented in Phase 2 against the database.
  throw new NotImplementedError(`getTour("${slug}")`);
}
