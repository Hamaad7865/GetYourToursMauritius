import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { getServerEnv } from '@/lib/config/env';
import { publicServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { getActivity } from '@/lib/services/activities';
import { NotFoundError } from '@/lib/services/errors';
import { resolvePlaceByText } from '@/lib/maps/google-places';
import { resolveTourStops } from '@/lib/planner/from-tour';

export const runtime = 'edge';

function mapsKey(): string | null {
  const env = getServerEnv();
  return env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
}

/**
 * GET /api/planner/from-tour?slug=<slug> — hand a sightseeing tour's itinerary to the AI Road Trip
 * Planner. Loads the tour, resolves each itinerary stop (title only) into a real Google place, and
 * returns `{ tour, slug, places }` so the planner can preload the day and let the customer customise
 * it. Graceful: an unknown tour, no maps key, or stops that don't resolve all return fewer/zero
 * places rather than erroring. Edge-cached since a tour's stops change rarely.
 *
 * Public + unauthenticated, and a cache MISS fans out one billed Places Text Search per itinerary
 * stop, so it is wallet-DoS-prone. Per-IP rate limit (DB-backed, defence in depth) caps floods BEFORE
 * the upstream calls, matching the sibling /api/planner/* routes; Cloudflare is the edge backstop.
 */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  await rateLimit(req, 'planner:from-tour', 30);
  const slug = (new URL(req.url).searchParams.get('slug') ?? '').trim();
  if (!slug) return jsonOk({ tour: null, slug: '', places: [] });

  let activity;
  try {
    activity = await getActivity(publicServiceContext(), slug);
  } catch (error) {
    if (error instanceof NotFoundError) return jsonOk({ tour: null, slug, places: [] });
    throw error;
  }

  const key = mapsKey();
  const stops = activity.extra.itinerary ?? [];
  const places = key ? await resolveTourStops(stops, (q) => resolvePlaceByText(q, key)) : [];

  return jsonOk(
    { tour: activity.title, slug: activity.slug, places },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
  );
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
