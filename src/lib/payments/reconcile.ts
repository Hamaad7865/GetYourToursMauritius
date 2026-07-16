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
 * SETTLED events (paid/refunded) are STRICT — all three or the event is QUARANTINED (no ledger
 * write; `outcome: 'quarantined:<reason>'`):
 *   - `providerReference` — the ledger's dedup key is (payment_id, provider_event_id), and NULLs
 *     never collide in that unique index, so a reference-less event would bypass dedup entirely;
 *   - `amountMinor` — an absent amount used to be credited as the FULL booking total, which turned a
 *     malformed provider payload into a full-value settlement. Writing a 0-amount placeholder would
 *     be worse: it would occupy the dedup slot and block the later complete event for good;
 *   - `currency` matching the payment's — an amount in the wrong currency credited at face value
 *     mis-settles the ledger.
 * Quarantine is self-healing: nothing is written, the booking stays payment_pending, and the
 * /payments/sync poll + the maintenance sweep re-query Peach's status endpoint (whose payload
 * carries amount + currency) on their normal cadence.
 *
 * A short 'paid' amount is recorded truthfully, so the ledger's `v_paid >= amount_minor` guard
 * leaves the booking pending rather than confirming an underpayment.
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
    .select('id, amount_minor, currency')
    .eq('booking_id', booking.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentErr) throw new Error(paymentErr.message);
  if (!payment) return { found: false, confirmed: false, outcome: event.outcome };

  const settled = event.outcome === 'paid' || event.outcome === 'refunded';
  if (settled) {
    const reason = !event.providerReference
      ? 'no_provider_reference'
      : event.amountMinor == null
        ? 'no_amount'
        : !event.currency
          ? 'no_currency'
          : event.currency.toUpperCase() !== payment.currency.toUpperCase()
            ? 'currency_mismatch'
            : null;
    if (reason) {
      // Loud, structured, PII-free: refs + reason only. The sweep counts this as errored.
      console.error('[reconcile] settled event quarantined', {
        reason,
        bookingRef: event.bookingRef,
        outcome: event.outcome,
        providerReference: event.providerReference,
        eventCurrency: event.currency ?? null,
        expectedCurrency: payment.currency,
        hasAmount: event.amountMinor != null,
      });
      return { found: true, confirmed: false, outcome: `quarantined:${reason}` };
    }
  }

  const amountMinor = settled ? event.amountMinor! : 0;
  // Whether THIS event fully satisfies the total (drives the caller's response flag; the DB confirm
  // is decided independently by append_payment_event summing credited amounts).
  const fullyPaid = event.outcome === 'paid' && event.amountMinor! >= payment.amount_minor;

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
