import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { homePicks } from '@/lib/services/home-picks';

export const runtime = 'edge';

/**
 * GET /api/v1/activities/picks — most-booked tours and tours with a free seat tomorrow (public). The
 * answer is the same for every visitor, so a short edge cache is safe; "free tomorrow" is at most a
 * couple of minutes old, and the booking widget re-checks the real seat anyway.
 */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  const ctx = buildServiceContext(req);
  const picks = await homePicks(ctx);
  return jsonOk(picks, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
