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
 * ACK-FIRST: we reply 200 immediately (after only parsing the body — no network), then verify + confirm
 * in `after()`, AFTER the response is sent. A slow reply could be treated as a failed delivery, so the
 * provider never waits on us. The background task is best-effort: if it's ever dropped, the customer's
 * /payments/sync poll and the reconcile cron still confirm the booking — confirmation is never lost.
 * We ALWAYS return 200 (any non-200 is treated by the provider as a failed delivery).
 *
 * The notification is only a TRIGGER. We never trust its body to confirm a booking (it's unsigned and
 * forgeable): we re-query the provider for the authoritative status and append THAT to the ledger.
 * Crucially we re-query using the checkout id we STORED at create time — looked up by the booking ref
 * the provider echoes back (`merchantTransactionId`) — NOT the id in the webhook body, which Peach sends
 * in a form that 404s at /v2/checkout/{id}/status. This is the same id /payments/sync and the reconcile
 * cron query successfully, so the webhook now confirms reliably.
 */
export const POST = apiHandler(async (req) => {
  const rawBody = await req.text();
  const contentType = req.headers.get('content-type') ?? '';
  const bookingRef = extractWebhookFields(rawBody, contentType).merchantTransactionId;

  if (bookingRef) {
    try {
      after(async () => {
        try {
          const admin = createServiceRoleClient();
          // Resolve the booking + the checkout id we stored when we created the checkout.
          const { data: booking } = await admin
            .from('bookings')
            .select('id')
            .eq('ref', bookingRef)
            .maybeSingle();
          if (!booking) return; // unknown ref (not ours / not yet created) — nothing to do
          const { data: payment } = await admin
            .from('payments')
            .select('provider_checkout_id')
            .eq('booking_id', booking.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          const checkoutId = payment?.provider_checkout_id;
          if (!checkoutId) return;

          const event = await getPaymentProvider().getCheckoutStatus(checkoutId);
          await reconcilePaymentEvent(admin, event);
        } catch (err) {
          // Provider unreachable / transient DB error — the /payments/sync poll + reconcile cron retry.
          console.warn('[webhook] background reconcile failed:', err instanceof Error ? err.message : err);
        }
      });
    } catch (err) {
      // after() unavailable in this runtime — fall back to the sync poll + reconcile sweep, still 200.
      console.warn('[webhook] could not schedule background reconcile:', err instanceof Error ? err.message : err);
    }
  } else {
    console.warn('[webhook] notification without a merchantTransactionId; acknowledging');
  }

  return jsonOk({ received: true });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
