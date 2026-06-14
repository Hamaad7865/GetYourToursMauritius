import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { captureLeadInputSchema } from '@/lib/validation/booking';
import { captureLead } from '@/lib/services/leads';

export const runtime = 'edge';

/** POST /api/v1/leads — capture a sales lead (public). */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const input = await parseJsonBody(req, captureLeadInputSchema);
  const ctx = buildServiceContext(req);
  const lead = await captureLead(ctx, input);
  return jsonOk(lead, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
