import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { loadCallerAccess, type AccessClient } from '@/lib/http/access';
import { serviceRoleServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { can } from '@/lib/admin/permissions';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { ForbiddenError } from '@/lib/services/errors';
import { resetGuestLink } from '@/lib/services/guest';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/admin/bookings/:ref/guest-link/reset — the "Reset guest link" button in the booking
 * drawer, for a link that has leaked. Every link already emailed for this booking stops working; the
 * guest can ask for a fresh one at /bookings/find. Bookings section only, checked against the caller's
 * role permissions, never the JWT's Postgres role.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  const user = await requireUser(req);
  await rateLimit(req, 'admin:guest_link_reset', 20);
  const db = createServiceRoleClient() as unknown as AccessClient;
  const access = await loadCallerAccess(db, user.id);
  if (!can(access, 'section.bookings')) throw new ForbiddenError();

  const { ref } = await params;
  const version = await resetGuestLink(serviceRoleServiceContext(), { ref, staffId: user.id });
  return jsonOk({ ref, version });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
