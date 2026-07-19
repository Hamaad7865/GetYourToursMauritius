import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { getServerEnv } from '@/lib/config/env';
import { listBmtActivities } from '@/lib/planner/our-activities';

export const runtime = 'edge';

function mapsKey(): string | null {
  const env = getServerEnv();
  return env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
}

/**
 * GET /api/planner/our-activities — the planner map's "Belle Mare Tours activities" layer: every
 * published catalogue activity with a resolved representative point (see our-activities.ts), for the
 * branded markers + recommendation cards. Public read-only catalogue data; a cache MISS fans out to
 * the catalogue RPCs (and rarely Places), so it is rate-limited like the other planner routes and
 * served with an edge cache header.
 */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  await rateLimit(req, 'planner:our-activities', 30);
  const ctx = buildServiceContext(req);
  const activities = await listBmtActivities(ctx, mapsKey());
  return jsonOk(activities, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
