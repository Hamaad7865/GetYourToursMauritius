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
  const bookingRef = extractWebhookFields(
    rawBody,
    headers['content-type'] ?? '',
  ).merchantTransactionId;

  if (bookingRef || headers['x-webhook-signature']) {
    try {
      after(async () => {
        const admin = createServiceRoleClient();
        const provider = getPaymentProvider();

        // 1) HMAC fast-path: a verified signature authenticates the body — confirm straight from it.
        try {
          const event = await provider.verifyWebhook({
            rawBody,
            signature: headers['x-webhook-signature'] ?? null,
            headers,
          });
          const reconciled = await reconcilePaymentEvent(admin, event);
          if (reconciled.outcome.startsWith('quarantined:')) {
            // Nothing was written (incomplete settled payload) — the sync poll / sweep will re-query
            // the status endpoint, whose payload is complete. Still ACK 200: a provider retry would
            // resend the same incomplete body.
            console.error('[webhook] settled event quarantined', {
              bookingRef,
              outcome: reconciled.outcome,
            });
          }
          return;
        } catch (hmacErr) {
          // Only worth a log when a signature WAS present (HMAC was attempted and failed → likely a
          // PEACH_WEBHOOK_SECRET / PEACH_WEBHOOK_URL mismatch). An unsigned webhook just uses path 2.
          if (headers['x-webhook-signature']) {
            console.warn(
              '[webhook] HMAC verify failed, falling back to re-query:',
              hmacErr instanceof Error ? hmacErr.message : hmacErr,
            );
          }
        }

        // 2) Re-query fallback (works without HMAC). The id in the webhook body 404s at the status
        //    endpoint, so we use the checkout id we stored at create time, found by the booking ref.
        try {
          if (!bookingRef) return;
          const { data: booking } = await admin
            .from('bookings')
            .select('id, status')
            .eq('ref', bookingRef)
            .maybeSingle();
          // Only re-query Peach for a booking still awaiting payment. A terminal/confirmed booking never
          // needs it, and this stops the endpoint being driven as a Peach status-query amplifier with
          // guessed refs (a duplicate webhook for an already-confirmed booking is also a no-op here).
          if (!booking || booking.status !== 'payment_pending') return;
          const { data: payment } = await admin
            .from('payments')
            .select('provider_checkout_id')
            .eq('booking_id', booking.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          const checkoutId = payment?.provider_checkout_id;
          if (!checkoutId) return;

          const event = await provider.getCheckoutStatus(checkoutId);
          await reconcilePaymentEvent(admin, event);
        } catch (err) {
          console.warn(
            '[webhook] background reconcile failed:',
            err instanceof Error ? err.message : err,
          );
        }
      });
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
