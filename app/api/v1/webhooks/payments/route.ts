import { after } from 'next/server';
import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { getPaymentProvider } from '@/lib/payments';
import { extractWebhookFields } from '@/lib/payments/peach';
import { processPaymentWebhook } from '@/lib/payments/webhook';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * POST /api/v1/webhooks/payments — the payment provider calls this when a checkout settles.
 *
 * ACK-FIRST: reply 200 immediately (after only parsing the body — no network), then verify + confirm in
 * `after()`, AFTER the response is sent, so the provider never waits on us (a slow reply can be treated
 * as a failed delivery). The background task is best-effort: if it's ever dropped, the customer's
 * /payments/sync poll and the reconcile cron still confirm the booking — confirmation is never lost.
 * We ALWAYS return 200 (any non-200 is treated by the provider as a failed delivery).
 *
 * Confirmation, in order of preference:
 *  1. HMAC fast-path — if the webhook is signed and PEACH_WEBHOOK_SECRET + PEACH_WEBHOOK_URL are set, the
 *     body is authenticated, so we trust it and reconcile directly (no extra Peach round-trip).
 *  2. Re-query fallback — otherwise we look up the booking by the echoed merchantTransactionId and
 *     re-query its STORED checkout id (the id /payments/sync + the cron use), which never trusts the body.
 * Either way a forged/unsigned body can't confirm a booking.
 */
export const POST = apiHandler(async (req) => {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  // The echoed merchantTransactionId is either GENERATED and opaque (resolved through
  // payment_merchant_refs) or DERIVED from the booking ref (parsed directly). We can't tell which
  // without a database round-trip, and this runs before the ACK — so gate on having ANY id at all and
  // let the background task resolve it. See resolveBookingRef for why both schemes stay live.
  const merchantTransactionId = extractWebhookFields(
    rawBody,
    headers['content-type'] ?? '',
  ).merchantTransactionId;

  if (merchantTransactionId || headers['x-webhook-signature']) {
    try {
      after(() =>
        processPaymentWebhook(createServiceRoleClient(), getPaymentProvider(), {
          rawBody,
          headers,
          merchantTransactionId,
        }),
      );
    } catch (err) {
      console.warn(
        '[webhook] could not schedule background reconcile:',
        err instanceof Error ? err.message : err,
      );
    }
  } else {
    console.warn('[webhook] notification without a merchantTransactionId; acknowledging');
  }

  return jsonOk({ received: true });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
