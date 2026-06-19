import { cache } from 'react';
import { publicServiceContext } from '@/lib/http/context';
import { listPlannerPlaces } from '@/lib/services/planner';
import { ADDITIONAL_ATTRACTIONS_RAW } from '@/lib/content/_additional-attractions.gen';
import type { PlannerPlace } from '@/lib/validation/planner';

/**
 * Public read of the attractions shown on the SEO pages: the `planner_places` DB set (also
 * used by the AI planner) PLUS a code-based additional set (so we can grow the catalogue
 * without DB writes). Cached per-request so the index, detail and sitemap share one fetch.
 */
export const loadPlaces = cache(async (): Promise<PlannerPlace[]> => {
  let dbPlaces: PlannerPlace[] = [];
  try {
    dbPlaces = await listPlannerPlaces(publicServiceContext());
  } catch (error) {
    console.error('[places] fetch failed', error);
  }
  const seen = new Set(dbPlaces.map((p) => p.id));
  const extra = ADDITIONAL_ATTRACTIONS_RAW.filter((p) => !seen.has(p.id));
  return [...dbPlaces, ...extra];
});

export async function getPlace(slug: string): Promise<PlannerPlace | null> {
  const all = await loadPlaces();
  return all.find((p) => p.id === slug) ?? null;
}
