import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { rateLimit } from '@/lib/http/rate-limit';
import { serviceRoleRpcContext } from '@/lib/http/context';
import { submitGuestReview } from '@/lib/services/reviews';
import { submitGuestReviewInputSchema } from '@/lib/validation/reviews';
import { jsonOk } from '@/lib/http/envelope';

export const runtime = 'edge';

/**
 * POST /api/v1/reviews/submit — guest-safe review submission (no login). The token, not auth.uid(),
 * proves the caller is the actual customer; api_submit_guest_review validates it server-side and is
 * single-use. Rate-limited to blunt brute-force token guessing — the token's own entropy and
 * single-use property are the real guard. Called via a service-role context because
 * api_submit_guest_review is granted to anon/authenticated directly (no user identity needed), the
 * same pattern as api_create_hold.
 */
export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'reviews:submit', 5);
  const input = await parseJsonBody(req, submitGuestReviewInputSchema);
  const ctx = serviceRoleRpcContext();
  const result = await submitGuestReview(ctx, input);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
