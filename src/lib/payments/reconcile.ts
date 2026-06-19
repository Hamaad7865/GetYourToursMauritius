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
 * Currency note: the ledger is EUR (the catalogue/booking currency) while cards are charged in USD.
 * A successful full settlement therefore confirms against the EUR booking total — we do NOT push the
 * USD-denominated reported amount into the EUR ledger. The raw provider payload (with the real USD
 * amount) is stored on the event for audit.
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

  // A successful full charge satisfies the EUR total in full; a refund reverses the same amount.
  const settled = event.outcome === 'paid' || event.outcome === 'refunded';
  const amountMinor = settled ? payment.amount_minor : 0;

  const { error: rpcErr } = await admin.rpc('append_payment_event', {
    p_payment_id: payment.id,
    p_type: event.outcome,
    p_provider_event_id: event.providerReference,
    p_amount_minor: amountMinor,
    p_occurred_at: new Date().toISOString(),
    p_payload: (event.raw ?? {}) as Json,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  return { found: true, confirmed: event.outcome === 'paid', outcome: event.outcome };
}
