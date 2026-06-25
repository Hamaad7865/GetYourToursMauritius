import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { listTransferAreas } from '@/lib/services/transfers';

export const runtime = 'edge';

/** GET /api/v1/transfers/areas — the curated point-to-point area picker list (public). */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  const ctx = buildServiceContext(req);
  const areas = await listTransferAreas(ctx);
  return jsonOk(areas, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
