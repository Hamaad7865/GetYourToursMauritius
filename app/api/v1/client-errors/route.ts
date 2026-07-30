import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { rateLimit, clientIp } from '@/lib/http/rate-limit';
import { clientErrorReportSchema } from '@/lib/validation/telemetry';
import { log } from '@/lib/log';
import { recordError } from '@/lib/error-log';

export const runtime = 'edge';

/**
 * POST /api/v1/client-errors — receives browser-side crash reports (from the error boundaries and the
 * global window error / unhandledrejection listeners) and writes them to the server log pipeline so
 * they're visible alongside server errors, plus a durable row in `error_logs` (source 'browser').
 * Per-IP rate limited so it can't be used to flood either.
 */
export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'client_errors', 30, 60);
  const report = await parseJsonBody(req, clientErrorReportSchema);
  // The IP goes to the log stream only (rate-limit forensics, short-lived). It is deliberately NOT
  // persisted: error_logs is retained for 30 days and holds no personal data.
  log.error('client_error', { ...report, ip: clientIp(req) });
  await recordError({
    source: 'browser',
    event: 'client_error',
    message: report.message,
    errorName: report.kind,
    stack: report.stack,
    // The page the customer was on — the browser-side equivalent of a route.
    route: report.url,
    userAgent: report.ua,
    // `kind` is already the row's error_name; keep the script source + boundary digest here.
    context: { scriptSource: report.source, digest: report.digest },
  });
  return jsonOk({ received: true }, { status: 202 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
