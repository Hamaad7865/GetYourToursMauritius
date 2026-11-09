import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import type { PaymentEvent, PaymentProvider } from './types';
import { bookingRefFromMerchantTransactionId } from './merchant-ref';
import { reconcilePaymentEvent, resolveBookingRef } from './reconcile';

export interface PaymentWebhookInput {
  rawBody: string;
  /** Request headers, lower-cased keys. */
  headers: Record<string, string>;
  /** The merchantTransactionId echoed in the body (parsed before the ACK). Selects which of OUR rows to
   *  re-query — never what to query: the status call always uses a checkout id we stored ourselves. */
  merchantTransactionId: string | null;
}

/**
 * The background half of POST /api/v1/webhooks/payments: everything the route does AFTER it has
 * already answered 200. Lives here, out of the route, so it can be tested against real Postgres.
 *
 * Confirmation, in order of preference:
 *  1. HMAC fast-path — a verified signature authenticates the body, so reconcile straight from it.
 *  2. Re-query fallback — find the booking by the echoed merchantTransactionId and re-query the
 *     checkout id WE stored at create time. The body is never trusted on this path.
 *
 * Never throws: the route has already ACKed, and there is nobody left to report an error to.
 */
export async function processPaymentWebhook(
  admin: SupabaseClient<Database>,
  provider: PaymentProvider,
  input: PaymentWebhookInput,
): Promise<void> {
  const { rawBody, headers, merchantTransactionId } = input;

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
        merchantTransactionId,
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
  //    endpoint, so we use the checkout id we stored at create time.
  try {
    // A GENERATED id names exactly one payment row and carries 65 random bits, so nobody can guess
    // one to drive status queries — which is what lets it reach that row WHATEVER its booking's
    // status. That matters: the captures this path exists for land on bookings that stopped waiting.
    // Production 2026-10-30, BMT41EDB8E4EA1D4: the cron expired the booking, Peach captured on the
    // still-open session 90 seconds later, and the old `status !== 'payment_pending'` gate below
    // dropped the only signal we got. A follow-on charge (a tour change, a balance) lives on a
    // CONFIRMED booking and was dropped by the same gate.
    const mapped = merchantTransactionId ? await mappedPayment(admin, merchantTransactionId) : null;
    if (mapped) {
      await requeryPaymentRow(admin, provider, mapped);
      return;
    }

    // A legacy DERIVED id is the booking ref itself, so it is guessable: keep it on the old footing.
    const bookingRef = await resolveBookingRef(
      admin,
      merchantTransactionId,
      bookingRefFromMerchantTransactionId(merchantTransactionId),
    );
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
}

interface MappedPaymentRow {
  id: string;
  amount_minor: number;
  paid_minor: number | null;
  provider_checkout_id: string | null;
  prev_provider_checkout_id: string | null;
}

/** The payment row a generated merchant id was recorded against, or null for an unmapped id. */
async function mappedPayment(
  admin: SupabaseClient<Database>,
  merchantTransactionId: string,
): Promise<MappedPaymentRow | null> {
  const { data: ref, error: refErr } = await admin
    .from('payment_merchant_refs')
    .select('payment_id')
    .eq('merchant_txn_id', merchantTransactionId)
    .maybeSingle();
  if (refErr) throw new Error(refErr.message);
  if (!ref?.payment_id) return null;
  const { data: row, error: rowErr } = await admin
    .from('payments')
    .select('id, amount_minor, paid_minor, provider_checkout_id, prev_provider_checkout_id')
    .eq('id', ref.payment_id)
    .maybeSingle();
  if (rowErr) throw new Error(rowErr.message);
  return row ?? null;
}

/**
 * Re-query a payment row's stored sessions and reconcile what Peach reports.
 *
 * BOTH sessions: the current one and the one a re-pay retired. A retired session stays completable at
 * Peach for ~30 minutes, so the money can arrive on either. A paid answer wins; otherwise the current
 * session's answer is recorded, which is what this path always did for a booking still waiting.
 */
async function requeryPaymentRow(
  admin: SupabaseClient<Database>,
  provider: PaymentProvider,
  row: MappedPaymentRow,
): Promise<void> {
  // Already holds its money: a replayed notification has nothing left to find.
  if (row.amount_minor > 0 && (row.paid_minor ?? 0) >= row.amount_minor) return;

  const sessions = [row.provider_checkout_id, row.prev_provider_checkout_id].filter(
    (id, i, all): id is string => Boolean(id) && all.indexOf(id) === i,
  );
  let current: PaymentEvent | null = null;
  for (const checkoutId of sessions) {
    const event = await provider.getCheckoutStatus(checkoutId);
    if (event.outcome === 'paid') {
      await reconcilePaymentEvent(admin, event);
      return;
    }
    current ??= event;
  }
  if (current) await reconcilePaymentEvent(admin, current);
}
