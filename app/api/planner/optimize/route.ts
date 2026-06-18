import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { plannerOptimizeInputSchema } from '@/lib/validation/planner';
import { getOptimizedStopOrder } from '@/lib/maps/route-optimization';

export const runtime = 'edge';

/**
 * POST /api/planner/optimize — optimal driving order for the day's stops, via the Google Route
 * Optimization API. Returns `{ order }` where `order` is the stop indices in optimal visiting order,
 * or `null` when optimization is unavailable (no service account / upstream error) — the planner then
 * keeps the current order. Best-effort: never errors the planner.
 */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const { pickup, stops } = await parseJsonBody(req, plannerOptimizeInputSchema);
  const order = await getOptimizedStopOrder(pickup, stops);
  return jsonOk({ order });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
