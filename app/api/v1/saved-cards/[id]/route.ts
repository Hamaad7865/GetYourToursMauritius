import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { deleteSavedCard } from '@/lib/services/saved-cards';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ id: string }> };

/** DELETE /api/v1/saved-cards/{id} — forget one of the caller's own saved cards (idempotent). Owner-scoped
 *  in the RPC (deletes only where user_id = auth.uid()); 401 for an anonymous caller. */
export const DELETE = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { id } = await params;
  const ctx = buildServiceContext(req);
  const result = await deleteSavedCard(ctx, id);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
