import { apiHandler, parseQuery } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { getServerEnv } from '@/lib/config/env';
import { fetchOwnGoogleReviews } from '@/lib/maps/google-own-reviews';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { can } from '@/lib/admin/permissions';
import { loadCallerAccess, type AccessClient } from '@/lib/http/access';
import { ForbiddenError } from '@/lib/services/errors';
import { z } from 'zod';

export const runtime = 'edge';

const querySchema = z.object({ placeId: z.string().min(1) });

/**
 * GET /api/v1/reviews/google-live?placeId=... — needs the Reviews section (`section.reviews`). The
 * JWT's own `role` claim is the Postgres role selector (anon/authenticated/service_role), never the
 * app's business role — `loadCallerAccess` reads the caller's profile and team role through the
 * service-role client. Needs a server-only API key (GOOGLE_MAPS_API_KEY is not NEXT_PUBLIC), so it
 * can't be called directly from the browser like most admin data — this thin route is the exception.
 * No DB write, no persistence.
 */
export const GET = apiHandler(async (req) => {
  const user = await requireUser(req);
  const access = await loadCallerAccess(
    createServiceRoleClient() as unknown as AccessClient,
    user.id,
  );
  if (!can(access, 'section.reviews')) {
    throw new ForbiddenError("Your role doesn't include Reviews — ask the owner.");
  }
  const { placeId } = parseQuery(req, querySchema);
  const env = getServerEnv();
  const apiKey = env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return jsonError(503, 'not_configured', 'Google Maps API key is not configured');
  const result = await fetchOwnGoogleReviews(placeId, apiKey);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
