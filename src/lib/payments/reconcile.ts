import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import type { PaymentEvent } from './types';

export interface ReconcileResult {
  /** A booking + payment row were found for the event's reference. */
  found: boolean;
  /** The booking was confirmed (a full successful settlement). */
  confirmed: boolean;
  outcome: string;
}

/**
 * Append a VERIFIED provider payment event to the event-sourced ledger via `append_payment_event`,
 * which derives the payment state and confirms the booking on first full payment. Requires a
 * service-role client (RLS bypass) and is the single shared path used by both the webhook and the
 * status re-query, so confirmation behaves identically however the signal arrives. Idempotent at the
 * ledger (duplicate provider events are ignored).
 *
 * Amount verification: the card is charged in EUR (== the ledger), so a 'paid' event credits the
 * amount the provider ACTUALLY settled (`event.amountMinor`), not the expected booking total. That
 * makes `append_payment_event`'s underpayment guard meaningful: a short/partial capture credits less
 * than the total, so `v_paid < amount_minor` leaves the booking PENDING (manual review) instead of
 * confirming it as fully paid. When the provider reports no amount (`amountMinor` null) we fall back
 * to the booking total per the PaymentEvent contract. The raw payload is stored on the event for audit.
 */
export async function reconcilePaymentEvent(
  admin: SupabaseClient<Database>,
  event: PaymentEvent,
): Promise<ReconcileResult> {
  if (!event.bookingRef) return { found: false, confirmed: false, outcome: event.outcome };

  const { data: booking, error: bookingErr } = await admin
    .from('bookings')
    .select('id')
    .eq('ref', event.bookingRef)
    .maybeSingle();
  if (bookingErr) throw new Error(bookingErr.message); // transient → caller returns 5xx → provider retries
  if (!booking) return { found: false, confirmed: false, outcome: event.outcome };

  const { data: payment, error: paymentErr } = await admin
    .from('payments')
    .select('id, amount_minor')
    .eq('booking_id', booking.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentErr) throw new Error(paymentErr.message);
  if (!payment) return { found: false, confirmed: false, outcome: event.outcome };

  // Credit what the provider actually settled (paid/refunded), falling back to the booking total only
  // when the provider reports no amount. A short 'paid' amount is recorded truthfully, so the ledger's
  // `v_paid >= amount_minor` guard leaves the booking pending rather than confirming an underpayment.
  const settled = event.outcome === 'paid' || event.outcome === 'refunded';
  const amountMinor = settled ? (event.amountMinor ?? payment.amount_minor) : 0;
  // Whether THIS event fully satisfies the total (drives the caller's response flag; the DB confirm
  // is decided independently by append_payment_event summing credited amounts).
  const fullyPaid =
    event.outcome === 'paid' && (event.amountMinor == null || event.amountMinor >= payment.amount_minor);

  const { error: rpcErr } = await admin.rpc('append_payment_event', {
    p_payment_id: payment.id,
    p_type: event.outcome,
    p_provider_event_id: event.providerReference,
    p_amount_minor: amountMinor,
    p_occurred_at: new Date().toISOString(),
    p_payload: (event.raw ?? {}) as Json,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  return { found: true, confirmed: fullyPaid, outcome: event.outcome };
}
