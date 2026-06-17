import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { createHoldInputSchema } from '@/lib/validation/booking';
import { createHold } from '@/lib/services/holds';

export const runtime = 'edge';

/** POST /api/v1/holds — reserve the spot for a date (guest or authenticated). */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const input = await parseJsonBody(req, createHoldInputSchema);
  const ctx = buildServiceContext(req);
  const hold = await createHold(ctx, input);
  return jsonOk(hold, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
