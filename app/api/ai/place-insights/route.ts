import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { placeInsightsInputSchema } from '@/lib/validation/planner';
import { generatePlaceInsights } from '@/lib/services/place-insights';

export const runtime = 'edge';

/** POST /api/ai/place-insights — AI Insights about the day's places (per-place + an overall tip).
 *
 * Public + unauthenticated, and calls billed Gemini, so it is wallet-DoS-prone. Per-IP rate limit
 * (DB-backed, defence in depth) caps floods; Cloudflare is the primary control at the edge. */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const ctx = buildServiceContext(req);
  await rateLimit(req, ctx, 'ai:place-insights', 30);
  const input = await parseJsonBody(req, placeInsightsInputSchema);
  const insights = await generatePlaceInsights(ctx, input.places);
  return jsonOk({ insights });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
