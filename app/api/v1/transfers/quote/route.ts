import { apiHandler, parseQuery } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { transferQuoteQuerySchema } from '@/lib/validation/transfers';
import { quoteTransfer } from '@/lib/services/transfers';

export const runtime = 'edge';

/** GET /api/v1/transfers/quote — a read-only fare estimate that equals the api_book charge for the same
 *  inputs (public). Server recomputes from the zone/band fare tables — never trusts a client price. */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  const query = parseQuery(req, transferQuoteQuerySchema);
  const ctx = buildServiceContext(req);
  const quote = await quoteTransfer(ctx, query);
  return jsonOk(quote);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
