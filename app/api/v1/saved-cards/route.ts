import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { listSavedCards } from '@/lib/services/saved-cards';

export const runtime = 'edge';

/** GET /api/v1/saved-cards — the signed-in user's saved cards (metadata only, never the token), newest
 *  first. Owner-scoped; private (never cached). 401 for an anonymous caller. */
export const GET = apiHandler(async (req) => {
  await requireUser(req);
  const ctx = buildServiceContext(req);
  const items = await listSavedCards(ctx);
  return jsonOk(items);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
