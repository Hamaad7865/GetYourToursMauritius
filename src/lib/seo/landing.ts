import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import type { SearchToursQuery, TourSummary } from '@/lib/validation/tours';

/**
 * Featured bookable activities for an SEO landing page.
 *
 * Resilient to category-name drift on the live catalogue: it tries the exact category first, then a
 * free-text query, and — only when neither was supplied (the broad "tours" hubs) — a general listing.
 * When a category/query IS supplied but matches nothing, it returns [] so the page can hide its grid
 * rather than show off-topic tours. Never throws: a catalogue/DB hiccup yields [] and the page still
 * renders its editorial content + links.
 */
export async function featuredActivities(
  opts: { category?: string; q?: string; limit?: number } = {},
): Promise<TourSummary[]> {
  const limit = opts.limit ?? 6;
  const ctx = publicServiceContext();

  const fetchPage = async (query: { category?: string; q?: string }): Promise<TourSummary[]> => {
    try {
      const { items } = await searchActivities(ctx, { ...query, page: 1, pageSize: limit });
      return items;
    } catch (error) {
      console.error('[landing] catalogue fetch failed', error);
      return [];
    }
  };

  if (opts.category) {
    const byCategory = await fetchPage({ category: opts.category });
    if (byCategory.length > 0) return byCategory;
  }
  if (opts.q) {
    const byQuery = await fetchPage({ q: opts.q });
    if (byQuery.length > 0) return byQuery;
  }
  // Broad hubs (no category/query) get a general listing; a targeted page that matched nothing gets [].
  if (!opts.category && !opts.q) return fetchPage({});
  return [];
}

export interface ActivityGroup {
  title: string;
  intro: string;
  activities: TourSummary[];
}

const BOAT_TRIP_CATEGORIES = ['Catamaran cruises', 'Private Cruises', 'Speedboat Tours'];
const SIGHTSEEING_CATEGORY = 'Taxi Sightseeing tours';

/**
 * Belle Mare / east-coast activities, grouped for the /things-to-do-in-belle-mare showcase:
 * "Boat trips & Île aux Cerfs" (East-region boat/cruise categories), "Sightseeing & day tours"
 * (every Private Sightseeing tour, any region — a flagship product line included regardless of which
 * part of the island it explores), and a "More ways to explore" catch-all for anything else tagged
 * East. A group is omitted entirely when empty, so a future catalogue change never renders a blank
 * heading. Never throws — a catalogue/DB hiccup yields [] for that fetch, same convention as
 * featuredActivities above.
 */
export async function belleMareActivityGroups(): Promise<ActivityGroup[]> {
  const ctx = publicServiceContext();

  const fetchAll = async (
    query: Pick<SearchToursQuery, 'region' | 'category'>,
  ): Promise<TourSummary[]> => {
    try {
      const { items } = await searchActivities(ctx, { ...query, page: 1, pageSize: 100 });
      return items;
    } catch (error) {
      console.error('[landing] belle mare catalogue fetch failed', error);
      return [];
    }
  };

  const [east, sightseeing] = await Promise.all([
    fetchAll({ region: 'East' }),
    fetchAll({ category: SIGHTSEEING_CATEGORY }),
  ]);

  const boatTrips = east.filter((a) => BOAT_TRIP_CATEGORIES.includes(a.category));
  const claimed = new Set([...boatTrips, ...sightseeing].map((a) => a.id));
  const catchAll = east.filter((a) => !claimed.has(a.id));

  return [
    {
      title: 'Boat trips & Île aux Cerfs',
      intro:
        "Catamarans, speedboats and private cruises that depart the east coast — Belle Mare's classic day on the water.",
      activities: boatTrips,
    },
    {
      title: 'Sightseeing & day tours',
      intro:
        'Private, door-to-door day tours with pickup from your Belle Mare hotel — see the rest of Mauritius at your own pace.',
      activities: sightseeing,
    },
    {
      title: 'More ways to explore',
      intro: 'A few more east-coast experiences worth adding to your Belle Mare itinerary.',
      activities: catchAll,
    },
  ].filter((g) => g.activities.length > 0);
}
