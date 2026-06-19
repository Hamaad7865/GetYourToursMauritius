import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { getPaymentProvider } from '@/lib/payments';
import { extractWebhookFields } from '@/lib/payments/peach';
import { reconcilePaymentEvent } from '@/lib/payments/reconcile';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import type { PaymentEvent } from '@/lib/payments/types';

export const runtime = 'edge';

/**
 * POST /api/v1/webhooks/payments — the payment provider calls this when a checkout settles. It's a
 * trigger, not a source of truth: we pull the checkout id from the (untrusted) body and ask the
 * provider DIRECTLY for the authoritative status (`getCheckoutStatus`), then append the verified
 * result to the ledger via the shared reconcile path — which confirms the booking on first full
 * payment. This is the only path (besides the client-driven /payments/sync) that confirms a booking,
 * and it does NOT depend on webhook HMAC signing being enabled.
 *
 * Acknowledgement: Peach treats any non-200 as a delivery failure (it retries and rejects the URL at
 * registration). So we ALWAYS return 200 once received — including the registration/validation ping,
 * an unknown checkout, or a forgery, none of which take action — and 5xx ONLY for a genuine transient
 * persistence error, where a retry can succeed.
 */
export const POST = apiHandler(async (req) => {
  const rawBody = await req.text();
  const provider = getPaymentProvider();
  const contentType = req.headers.get('content-type') ?? '';

  // The checkout id rides the notification body; re-query the provider for the authoritative status
  // so a forged or unsigned body can never confirm a booking (the status comes from an authenticated
  // call to the provider, not the request).
  const checkoutId = extractWebhookFields(rawBody, contentType).checkoutId;
  if (!checkoutId) {
    console.warn('[webhook] payment notification without a checkout id; acknowledging');
    return jsonOk({ received: true, verified: false });
  }

  let event: PaymentEvent;
  try {
    event = await provider.getCheckoutStatus(checkoutId);
  } catch (err) {
    // Could not reach the provider / unknown checkout — acknowledge so the provider doesn't retry a
    // hopeless request; the client-driven sync remains a fallback.
    console.warn('[webhook] status re-query failed:', err instanceof Error ? err.message : err);
    return jsonOk({ received: true, verified: false });
  }

  const admin = createServiceRoleClient();
  const result = await reconcilePaymentEvent(admin, event); // throws (→5xx) only on transient DB error
  return jsonOk({ received: true, outcome: event.outcome, confirmed: result.confirmed });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
