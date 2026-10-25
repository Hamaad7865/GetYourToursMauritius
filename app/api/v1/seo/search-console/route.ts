import { apiHandler, parseQuery } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { can } from '@/lib/admin/permissions';
import { loadCallerAccess, type AccessClient } from '@/lib/http/access';
import { ForbiddenError } from '@/lib/services/errors';
import { fetchSearchConsoleReport, NotConnectedError } from '@/lib/seo/search-console';
import { z } from 'zod';

export const runtime = 'edge';

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).default(28),
});

/**
 * GET /api/v1/seo/search-console?days=28 — needs the SEO section (`section.seo`).
 *
 * The JWT's own `role` claim is the Postgres role selector (anon/authenticated/service_role), NEVER
 * the app's business role — `loadCallerAccess` reads the caller's profile and team role through the
 * service-role client. A Content-only role holds `section.seo`: search performance is exactly what
 * that hire needs, and it carries no customer data.
 *
 * Needs a server-only service-account key, so unlike most admin data it cannot be read straight
 * from the browser — hence this thin route. No DB write, no persistence.
 */
export const GET = apiHandler(async (req) => {
  const user = await requireUser(req);
  const access = await loadCallerAccess(
    createServiceRoleClient() as unknown as AccessClient,
    user.id,
  );
  if (!can(access, 'section.seo')) {
    throw new ForbiddenError("Your role doesn't include SEO — ask the owner.");
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
