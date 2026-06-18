import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { placeInsightsInputSchema } from '@/lib/validation/planner';
import { generatePlaceInsights } from '@/lib/services/place-insights';

export const runtime = 'edge';

/** POST /api/ai/place-insights — AI Insights about the day's places (per-place + an overall tip). */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const input = await parseJsonBody(req, placeInsightsInputSchema);
  const ctx = buildServiceContext(req);
  const insights = await generatePlaceInsights(ctx, input.places);
  return jsonOk({ insights });
});
