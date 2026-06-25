import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { eraseAccountData } from '@/lib/services/account';

export const runtime = 'edge';

/**
 * POST /api/v1/account/delete — full account deletion (the only complete delete path). Re-verifies the
 * bearer, erases the caller's DB data (api_erase_user, run user-scoped so its self-guard holds), THEN
 * removes the auth user via the service-role Admin API. Data erasure first: if it fails we abort before
 * deleting the auth user; an auth-delete failure after erasure is logged but still reported as success
 * (the data-protection obligation is complete). Ports the web `deleteMyAccount` Server Action.
 */
export const POST = apiHandler(async (req) => {
  const user = await requireUser(req);
  const ctx = buildServiceContext(req);

  // 1. Erase the data first (as the user, so api_erase_user's auth.uid() self-guard passes).
  await eraseAccountData(ctx, user.id, user.email);

  // 2. Remove the auth user (Admin API; requires the service-role key). api_erase_user leaves it behind.
  const admin = createServiceRoleClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    // The data is already erased — a cleanup failure here is not a leak. Log (no PII) and still succeed.
    console.error('gdpr_auth_delete_failed', error.message);
  }

  return jsonOk({ deleted: true });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
