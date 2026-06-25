import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { exportAccount } from '@/lib/services/account';

export const runtime = 'edge';

/** GET /api/v1/account/export — the caller's GDPR data export (profile incl. dateOfBirth + bookings). */
export const GET = apiHandler(async (req) => {
  await requireUser(req);
  const ctx = buildServiceContext(req);
  return jsonOk(await exportAccount(ctx));
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
