import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { getPaymentProvider } from '@/lib/payments';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';

export const runtime = 'edge';

/**
 * POST /api/v1/webhooks/payments — the payment provider calls this when a checkout
 * settles. The provider verifies the signature and normalises the body into a
 * PaymentEvent; we then append it to the event-sourced ledger via `append_payment_event`
 * (service-role), which derives the payment state and CONFIRMS the booking on first full
 * payment. This is the ONLY path that confirms a booking — never a frontend success page.
 * Idempotent: duplicate provider events are ignored at the ledger.
 */
export const POST = apiHandler(async (req) => {
  const rawBody = await req.text();
  const provider = getPaymentProvider();

  let event;
  try {
    event = await provider.verifyWebhook({
      rawBody,
      signature: req.headers.get('x-signature') ?? req.headers.get('paymentlink-signature'),
      headers: Object.fromEntries(req.headers.entries()),
    });
  } catch {
    return jsonError(400, 'invalid_webhook', 'Could not verify the webhook payload');
  }

  if (!event.bookingRef) {
    return jsonError(400, 'invalid_webhook', 'Webhook is missing a booking reference');
  }

  const admin = createServiceRoleClient();

  const { data: booking, error: bookingErr } = await admin
    .from('bookings')
    .select('id')
    .eq('ref', event.bookingRef)
    .maybeSingle();
  if (bookingErr) throw new Error(bookingErr.message);
  if (!booking) return jsonError(404, 'not_found', 'Booking not found');

  const { data: payment, error: paymentErr } = await admin
    .from('payments')
    .select('id, amount_minor')
    .eq('booking_id', booking.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentErr) throw new Error(paymentErr.message);
  if (!payment) return jsonError(404, 'not_found', 'No payment exists for this booking');

  // Only settlement events carry money. Prefer the provider-reported amount (supports partial
  // captures/refunds — the ledger reducer handles those); fall back to the full booking total when
  // the provider did not report one (e.g. the dev stub).
  const settled = event.outcome === 'paid' || event.outcome === 'refunded';
  const reported =
    typeof event.amountMinor === 'number' && Number.isFinite(event.amountMinor) && event.amountMinor >= 0
      ? Math.round(event.amountMinor)
      : null;
  const amountMinor = settled ? (reported ?? payment.amount_minor) : 0;
  const { error: rpcErr } = await admin.rpc('append_payment_event', {
    p_payment_id: payment.id,
    p_type: event.outcome,
    p_provider_event_id: event.providerReference,
    p_amount_minor: amountMinor,
    p_occurred_at: new Date().toISOString(),
    p_payload: (event.raw ?? {}) as Json,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  return jsonOk({ received: true, outcome: event.outcome });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
