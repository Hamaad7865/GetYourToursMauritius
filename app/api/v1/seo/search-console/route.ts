import { apiHandler, parseQuery } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { fetchSearchConsoleReport, NotConnectedError } from '@/lib/seo/search-console';
import { z } from 'zod';

export const runtime = 'edge';

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).default(28),
});

/**
 * GET /api/v1/seo/search-console?days=28 — content-editor only (staff/admin/seo).
 *
 * The JWT's own `role` claim is the Postgres role selector (anon/authenticated/service_role), NEVER
 * the app's business role — this looks up profiles.role directly, the same pattern as
 * app/api/v1/reviews/google-live/route.ts. The 'seo' role IS admitted here: search performance is
 * exactly what that hire needs, and it carries no customer data.
 *
 * Needs a server-only service-account key, so unlike most admin data it cannot be read straight
 * from the browser — hence this thin route. No DB write, no persistence.
 */
export const GET = apiHandler(async (req) => {
  const user = await requireUser(req);
  const admin = createServiceRoleClient();
  const { data: profile, error } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.role !== 'admin' && profile?.role !== 'staff' && profile?.role !== 'seo') {
    return jsonError(403, 'forbidden', 'Content editors only');
  }

  const { days } = parseQuery(req, querySchema);
  try {
    return jsonOk(await fetchSearchConsoleReport(new Date(), days));
  } catch (e) {
    // "Not connected" is a configuration state, not a failure — the panel renders setup steps from
    // this message rather than an error banner.
    if (e instanceof NotConnectedError) {
      return jsonError(503, 'not_configured', e.message);
    }
    throw e;
  }
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
