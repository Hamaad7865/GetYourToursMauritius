import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { createHoldInputSchema } from '@/lib/validation/booking';
import { createHold } from '@/lib/services/holds';

export const runtime = 'edge';

/** POST /api/v1/holds — reserve the spot for a date (guest or authenticated). Per-IP rate-limited so an
 *  anonymous script can't sweep a hot occurrence's seats into 15-min holds and fake a "sold out". */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const ctx = buildServiceContext(req);
  await rateLimit(req, ctx, 'holds:create', 30);
  const input = await parseJsonBody(req, createHoldInputSchema);
  const hold = await createHold(ctx, input);
  return jsonOk(hold, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
