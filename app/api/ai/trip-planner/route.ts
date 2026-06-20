import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { plannerChatInputSchema } from '@/lib/validation/planner';
import { runPlannerTurn } from '@/lib/services/planner-agent';

export const runtime = 'edge';

/** POST /api/ai/trip-planner — one turn with the grounded AI Road Trip Planner co-pilot.
 *
 * Public + unauthenticated, and each turn fans out to BILLED Gemini + Google Places/Routes calls, so it
 * is wallet-DoS-prone. Per-IP rate limit (DB-backed, defence in depth) caps floods; the primary control
 * is still a Cloudflare Rate Limiting rule / Turnstile at the edge. The chat is the most expensive route
 * (a single turn can run several billed tool steps), so it gets the tightest cap. */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const ctx = buildServiceContext(req);
  await rateLimit(req, ctx, 'ai:trip-planner', 15);
  const input = await parseJsonBody(req, plannerChatInputSchema);
  const result = await runPlannerTurn(ctx, input);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
