import { after } from 'next/server';
import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { getPaymentProvider } from '@/lib/payments';
import { extractWebhookFields } from '@/lib/payments/peach';
import { reconcilePaymentEvent } from '@/lib/payments/reconcile';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * POST /api/v1/webhooks/payments — the payment provider calls this when a checkout settles.
 *
 * ACK-FIRST: we reply 200 immediately (after only parsing the body — no network), then do the
 * authoritative work in `after()`, AFTER the response is sent. The provider's notification is just a
 * trigger: the background task re-queries the provider DIRECTLY for the verified status
 * (`getCheckoutStatus`) and appends it to the ledger via the shared reconcile path (which confirms the
 * booking on first full payment) — so a forged/unsigned body can never confirm anything, and it does
 * NOT depend on webhook HMAC signing.
 *
 * Why ack-first: the verify+reconcile round-trip takes a few seconds (provider OAuth + status call + DB
 * writes). Doing it before responding made the provider wait, and a slow reply can be treated as a
 * delivery failure (and surfaced as a 5xx). Replying instantly removes response latency as a failure
 * mode. The background task is best-effort: if the platform ever drops it, the customer's
 * /payments/sync poll and the maintenance reconcile sweep still confirm the booking — confirmation is
 * never lost, only this one fast path. We ALWAYS return 200 (the provider treats any non-200 as a
 * failed delivery and retries / rejects the URL at registration).
 */
export const POST = apiHandler(async (req) => {
  const rawBody = await req.text();
  const contentType = req.headers.get('content-type') ?? '';
  const checkoutId = extractWebhookFields(rawBody, contentType).checkoutId;

  if (checkoutId) {
    try {
      after(async () => {
        try {
          const event = await getPaymentProvider().getCheckoutStatus(checkoutId);
          await reconcilePaymentEvent(createServiceRoleClient(), event);
        } catch (err) {
          // Provider unreachable / unknown checkout / transient DB error — the reconcile sweep retries.
          console.warn('[webhook] background reconcile failed:', err instanceof Error ? err.message : err);
        }
      });
    } catch (err) {
      // after() unavailable in this runtime — fall back to the sync poll + reconcile sweep, still 200.
      console.warn('[webhook] could not schedule background reconcile:', err instanceof Error ? err.message : err);
    }
  } else {
    console.warn('[webhook] payment notification without a checkout id; acknowledging');
  }

  return jsonOk({ received: true });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
