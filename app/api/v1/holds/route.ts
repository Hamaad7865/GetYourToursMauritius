import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { serviceRoleRpcContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { createHoldInputSchema } from '@/lib/validation/booking';
import { createHold } from '@/lib/services/holds';

export const runtime = 'edge';

/** POST /api/v1/holds — reserve the spot for a date (guest or authenticated). Per-IP rate-limited so an
 *  anonymous script can't sweep a hot occurrence's seats into 15-min holds and fake a "sold out". */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  await rateLimit(req, 'holds:create', 30);
  const input = await parseJsonBody(req, createHoldInputSchema);
  // api_create_hold is revoked from anon/authenticated (a direct anon-key call would bypass the limiter
  // above and let a bot squat a hot occurrence's seats), so create the hold through a service-role
  // client. The RPC is SECURITY DEFINER + identity-free, so this is behaviour-preserving.
  const hold = await createHold(serviceRoleRpcContext(), input);
  return jsonOk(hold, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
