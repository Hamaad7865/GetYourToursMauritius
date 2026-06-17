import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { plannerChatInputSchema } from '@/lib/validation/planner';
import { runPlannerTurn } from '@/lib/services/planner-agent';

export const runtime = 'edge';

/** POST /api/ai/trip-planner — one turn with the grounded AI Road Trip Planner co-pilot. */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const input = await parseJsonBody(req, plannerChatInputSchema);
  const ctx = buildServiceContext(req);
  const result = await runPlannerTurn(ctx, input);
  return jsonOk(result);
});
