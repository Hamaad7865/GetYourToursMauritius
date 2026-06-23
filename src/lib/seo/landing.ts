import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import type { TourSummary } from '@/lib/validation/tours';

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
