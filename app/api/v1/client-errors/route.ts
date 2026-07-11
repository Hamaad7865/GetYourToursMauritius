import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { rateLimit, clientIp } from '@/lib/http/rate-limit';
import { clientErrorReportSchema } from '@/lib/validation/telemetry';
import { log } from '@/lib/log';

export const runtime = 'edge';

/**
 * POST /api/v1/client-errors — receives browser-side crash reports (from the error boundaries and the
 * global window error / unhandledrejection listeners) and writes them to the server log pipeline so
 * they're visible alongside server errors. Per-IP rate limited so it can't be used to flood the logs.
 */
export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'client_errors', 30, 60);
  const report = await parseJsonBody(req, clientErrorReportSchema);
  log.error('client_error', { ...report, ip: clientIp(req) });
  return jsonOk({ received: true }, { status: 202 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
