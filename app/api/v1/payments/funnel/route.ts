import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { rateLimit } from '@/lib/http/rate-limit';
import { serviceRoleRpcContext } from '@/lib/http/context';
import { checkoutFunnelEventSchema } from '@/lib/validation/telemetry';
import { classifyUserAgent } from '@/lib/checkout/device-class';
import { logCheckoutEvent } from '@/lib/services/checkout-funnel';
import { log } from '@/lib/log';

export const runtime = 'edge';

/**
 * POST /api/v1/payments/funnel — one pay-page funnel event (widget ready, first input, cancelled,
 * page hidden…). Unauthenticated on purpose: it is sent with navigator.sendBeacon as the page unloads,
 * which cannot carry a bearer token. It writes nothing but a diagnostic row keyed by the Peach checkout
 * id, the device is derived HERE from the request's User-Agent (reduced to a class — the raw UA is
 * never stored), and it is per-IP rate limited. Always 202: telemetry must never surface an error to
 * a customer who is paying.
 */
export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'checkout_funnel', 60, 60);
  const input = await parseJsonBody(req, checkoutFunnelEventSchema);
  try {
    await logCheckoutEvent(
      serviceRoleRpcContext(),
      input,
      classifyUserAgent(req.headers.get('user-agent')),
    );
  } catch (error) {
    log.warn('checkout_funnel_write_failed', {
      event: input.event,
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
  return jsonOk({ received: true }, { status: 202 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
