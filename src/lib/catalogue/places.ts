import { cache } from 'react';
import { publicServiceContext } from '@/lib/http/context';
import { listPlannerPlaces } from '@/lib/services/planner';
import type { PlannerPlace } from '@/lib/validation/planner';

/**
 * Public read of the curated places (the same `planner_places` set the AI planner uses),
 * exposed for the SEO attraction pages. Cached per-request so the index, detail and
 * sitemap all share one fetch. Fails soft to an empty list.
 */
export const loadPlaces = cache(async (): Promise<PlannerPlace[]> => {
  try {
    return await listPlannerPlaces(publicServiceContext());
  } catch (error) {
    console.error('[places] fetch failed', error);
    return [];
  }
});

export async function getPlace(slug: string): Promise<PlannerPlace | null> {
  const all = await loadPlaces();
  return all.find((p) => p.id === slug) ?? null;
}
