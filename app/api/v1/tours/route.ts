import { apiHandler, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { paginationMeta } from '@/lib/http/pagination';
import { preflightResponse } from '@/lib/http/cors';
import { getBearerToken, requireUser } from '@/lib/http/auth';
import { searchToursQuerySchema } from '@/lib/validation/tours';
import { searchTours } from '@/lib/services/tours';
import type { ServiceContext } from '@/lib/services/context';
import { createUserClient } from '@/lib/supabase/client';
import { getPaymentProvider } from '@/lib/payments';
import { getAiProvider } from '@/lib/ai';

export const runtime = 'edge';

function buildContext(req: Request): ServiceContext {
  const token = getBearerToken(req);
  return {
    db: createUserClient(token),
    payments: getPaymentProvider(),
    ai: getAiProvider(),
    now: () => new Date(),
  };
}

/** GET /api/v1/tours — paginated catalogue search. Requires a valid Bearer token. */
export const GET = apiHandler(async (req) => {
  await requireUser(req);
  const query = parseQuery(req, searchToursQuerySchema);
  const ctx = buildContext(req);
  const { items, total } = await searchTours(ctx, query);
  return jsonOk(items, { meta: paginationMeta(query.page, query.pageSize, total) });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
