import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { profileUpdateSchema } from '@/lib/validation/account';
import { getProfile, updateProfile } from '@/lib/services/account';

export const runtime = 'edge';

/** GET /api/v1/account/profile — the caller's profile (created if missing). */
export const GET = apiHandler(async (req) => {
  await requireUser(req);
  const ctx = buildServiceContext(req);
  return jsonOk(await getProfile(ctx));
});

/** PATCH /api/v1/account/profile — update fullName/phone/dateOfBirth (only provided keys). */
export const PATCH = apiHandler(async (req) => {
  await requireUser(req);
  const input = await parseJsonBody(req, profileUpdateSchema);
  const ctx = buildServiceContext(req);
  return jsonOk(await updateProfile(ctx, input));
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
