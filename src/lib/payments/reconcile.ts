import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { log } from '@/lib/log';
import type { PaymentEvent } from './types';

export interface ReconcileResult {
  /** A booking + payment row were found for the event's reference. */
  found: boolean;
  /** The booking was confirmed (a full successful settlement). */
  confirmed: boolean;
  outcome: string;
}

/**
 * Fixed slack in CHARGE-currency minor units — MUR 1.00 (~EUR 0.019). NEVER a percentage: 0.5% of a
 * large MUR charge is real money. Absorbs a provider re-quantisation, nothing more. The charge is
 * minted in WHOLE RUPEES (api_create_payment), so in practice there is nothing to absorb.
 */
const CHARGE_TOLERANCE_MINOR = 100;

/**
 * Append a VERIFIED provider payment event to the event-sourced ledger via `append_payment_event`,
 * which derives the payment state and confirms the booking on first full payment. Requires a
 * service-role client (RLS bypass) and is the single shared path used by the webhook, the customer's
 * /payments/sync poll and the reconcile cron, so confirmation behaves identically however the signal
 * arrives. Idempotent at the ledger (duplicate provider events are ignored).
 *
 * TWO CURRENCIES, ONE LEDGER (since 2026-07-30): the card is CHARGED in MUR (the live Peach account
 * has no EUR facility) while the ledger stays EUR. `payments.charged_amount_minor` /
 * `charged_currency` — pinned once per payment row inside api_create_payment — are the EXPECTED
 * SETTLEMENT this function measures provider events against. The provider's MUR amount must NEVER
 * reach append_payment_event, which sums payment_events.amount_minor against payments.amount_minor
 * (the EUR total) with no currency awareness at all: at ~54 MUR/EUR a face-value credit would mark
 * every booking paid 54× over. A settlement that matches the pinned charge credits the FULL EUR
 * total; anything else quarantines.
 *
 * SETTLED events (paid/refunded) are STRICT — fail any gate and the event is QUARANTINED (no ledger
 * write; `outcome: 'quarantined:<reason>'`, `payments.settlement_review_at` flagged so the expiry
 * sweep cannot release a booking whose money may be real):
 *   - `providerReference` — the ledger's dedup key is (payment_id, provider_event_id), and NULLs
 *     never collide in that unique index, so a reference-less event would bypass dedup entirely;
 *   - `amountMinor` — an absent amount used to be credited as the FULL booking total, which turned a
 *     malformed provider payload into a full-value settlement;
 *   - `currency` matching the EXPECTED settlement currency (charged_currency, falling back to the
 *     ledger currency for EUR-era rows) — an amount in the wrong currency credited at face value
 *     mis-settles the ledger. A cross-currency event with NO charge record quarantines too: the rate
 *     that produced it is unknown, so it cannot be converted. Never guess.
 *   - a 'paid' amount short of the expected charge (beyond CHARGE_TOLERANCE_MINOR) — never a partial
 *     credit: a partial write burns the (payment_id, provider_event_id) dedup slot for good, drops
 *     the booking out of api_pending_payment_checkouts, and leaves payments.status='pending' so the
 *     expiry sweep would release the seat with the money taken.
 * Quarantine is self-healing where the payload was merely incomplete: nothing is written, the booking
 * stays payment_pending, and the /payments/sync poll + the maintenance sweep re-query Peach's status
 * endpoint (whose payload is complete) on their normal cadence.
 */
/**
 * What the ledger holds for one payment row after an append: how much has been credited, and the
 * total it is measured against.
 *
 * Prefers the row `append_payment_event` itself returned (it is the post-update state, no extra
 * round trip). Composite return values are decoded differently by different clients — PostgREST
 * hands back a JSON object, a raw pg driver can hand back the tuple as text — so an undecoded answer
 * falls through to a direct read rather than being guessed at. On a money path an unreadable answer
 * must never pass for a good one, which is why the caller treats `null` as "not credited".
 */
async function ledgerTotals(
  admin: SupabaseClient<Database>,
  returned: unknown,
  paymentId: string,
): Promise<{ paidMinor: number; totalMinor: number } | null> {
  const row = returned as { paid_minor?: unknown; amount_minor?: unknown } | null;
  if (row && typeof row === 'object' && typeof row.amount_minor === 'number') {
    return { paidMinor: Number(row.paid_minor ?? 0), totalMinor: row.amount_minor };
  }
  const { data } = await admin
    .from('payments')
    .select('paid_minor, amount_minor')
    .eq('id', paymentId)
    .maybeSingle();
  return data ? { paidMinor: data.paid_minor ?? 0, totalMinor: data.amount_minor } : null;
}

export async function reconcilePaymentEvent(
  admin: SupabaseClient<Database>,
  event: PaymentEvent,
): Promise<ReconcileResult> {
  if (!event.bookingRef) return { found: false, confirmed: false, outcome: event.outcome };

  const { data: booking, error: bookingErr } = await admin
    .from('bookings')
    .select('id, user_id')
    .eq('ref', event.bookingRef)
    .maybeSingle();
  if (bookingErr) throw new Error(bookingErr.message); // transient → caller returns 5xx → provider retries
  if (!booking) return { found: false, confirmed: false, outcome: event.outcome };

  // Bind the event to the payment row that OWNS it, not merely the booking's newest row.
  //
  // A booking can carry several payment rows, and each pins its own MUR charge at the fx rate in
  // force when it was created. Crediting an event against the wrong row corrupts a live payment's
  // state and measures the settlement against the wrong pin. Match on the checkout the provider says
  // the money moved on — `prev_provider_checkout_id` too, because a session minted before a re-pay
  // stays completable at Peach for ~30 minutes (the same reason api_pending_payment_checkouts sweeps
  // both ids). Matching in JS rather than a PostgREST `.or()` keeps a provider-supplied string out of
  // a filter-expression parser. Newest-first is the fallback for a provider that reports no checkout.
  const { data: rows, error: paymentErr } = await admin
    .from('payments')
    .select(
      'id, amount_minor, currency, paid_minor, refunded_minor, charged_amount_minor, charged_currency, provider_checkout_id, prev_provider_checkout_id',
    )
    .eq('booking_id', booking.id)
    .order('created_at', { ascending: false });
  if (paymentErr) throw new Error(paymentErr.message);
  const candidates = rows ?? [];
  const checkoutId = event.providerCheckoutId ?? null;
  const payment =
    (checkoutId
      ? (candidates.find((r) => r.provider_checkout_id === checkoutId) ??
        candidates.find((r) => r.prev_provider_checkout_id === checkoutId))
      : undefined) ?? candidates[0];
  if (!payment) return { found: false, confirmed: false, outcome: event.outcome };

  // What the card was ASKED to pay. Legacy/EUR-era rows carry no charge record; for those the ledger
  // IS the charge, which was the pre-MUR invariant. Post-cutover this can never be null: the pin
  // happens inside api_create_payment, so no session can exist without it.
  const ledgerCurrency = payment.currency.toUpperCase();
  const expectedCurrency = (payment.charged_currency ?? payment.currency).toUpperCase();
  const expectedMinor = payment.charged_amount_minor ?? payment.amount_minor;
  const paidMinor = payment.paid_minor ?? 0;
  const refundedMinor = payment.refunded_minor ?? 0;

  const settled = event.outcome === 'paid' || event.outcome === 'refunded';
  if (settled) {
    const eventCurrency = event.currency ? event.currency.toUpperCase() : null;
    const reason = !event.providerReference
      ? 'no_provider_reference'
      : event.amountMinor == null
        ? 'no_amount'
        : !eventCurrency
          ? 'no_currency'
          : payment.charged_amount_minor == null && eventCurrency !== ledgerCurrency
            ? 'no_charge_record'
            : eventCurrency !== expectedCurrency
              ? 'currency_mismatch'
              : !(expectedMinor > 0)
                ? 'no_charge_expectation'
                : event.outcome === 'paid' &&
                    event.amountMinor < expectedMinor - CHARGE_TOLERANCE_MINOR
                  ? 'short_settlement'
                  : null;
    if (reason) {
      // Loud, structured, PII-free: refs + reason only. The sweep counts this as errored.
      log.error('reconcile_settled_quarantined', {
        reason,
        bookingRef: event.bookingRef,
        outcome: event.outcome,
        providerReference: event.providerReference,
        settledCurrency: eventCurrency,
        settledMinor: event.amountMinor ?? null,
        expectedCurrency,
        expectedMinor,
        ledgerCurrency,
      });
      // Money may be real and we could not credit it: mark the payment for human review so the
      // expiry sweep cannot silently release the booking. Never allowed to throw — a throw here
      // would 5xx the webhook and make Peach retry the same uncreditable body forever.
      try {
        await admin.rpc('api_flag_settlement_review', {
          p: { paymentId: payment.id, reason },
        });
      } catch {
        log.error('reconcile_review_flag_failed', { bookingRef: event.bookingRef, reason });
      }
      return { found: true, confirmed: false, outcome: `quarantined:${reason}` };
    }
  }

  // ---- LEDGER CREDIT: always in the LEDGER currency (EUR), never the provider's raw figure.
  let amountMinor = 0;
  if (event.outcome === 'paid') {
    // Survived the short_settlement gate ⇒ the card paid the full expected charge ⇒ credit the full
    // EUR total. Idempotent: amount_minor is written once by api_create_payment and never updated,
    // and a replay under the same provider_event_id is deduped by append_payment_event.
    amountMinor = payment.amount_minor;
  } else if (event.outcome === 'refunded') {
    // Refunds are NOT quarantined on a short amount: a partial refund is legitimate (the owner
    // refunds by hand in Peach), and refunds reach the ledger only via the verified webhook — a
    // quarantined refund would never self-heal, because the re-query paths only run for
    // payment_pending bookings.
    const outstanding = Math.max(paidMinor - refundedMinor, 0);
    const base = paidMinor > 0 ? paidMinor : payment.amount_minor;
    amountMinor =
      event.amountMinor! >= expectedMinor - CHARGE_TOLERANCE_MINOR
        ? // Full reversal: credit the OUTSTANDING amount — the same formulation api_mark_refunded
          // uses — which is guaranteed to satisfy `v_refunded >= v_paid` and flip the state to
          // 'refunded'.
          outstanding
        : // Partial: pro-rate at the ORIGINAL charge ratio (never a fresh FX rate), clamped to
          // outstanding so a duplicate refund under a new provider_event_id credits 0 instead of
          // double-counting.
          Math.min(Math.round((base * event.amountMinor!) / expectedMinor), outstanding);
  }
  // NOTE: append_payment_event also sums type 'captured' alongside 'paid', but no PaymentOutcome
  // maps to 'captured', so this function can never write one. If a future outcome ever maps there,
  // it MUST go through the identical charge-vs-ledger conversion above — never at face value.

  // Whether THIS event fully satisfies the total. The short_settlement gate is what makes the
  // intent correct: any 'paid' event that gets here credited the FULL EUR total. But intent is not
  // outcome — this is only returned once the post-append check below has confirmed the ledger really
  // reached the total, and that check returns early if it did not. Do NOT reintroduce a comparison
  // against the provider's raw amount — MUR minor units are ~54× EUR minor units.
  const fullyPaid = event.outcome === 'paid';

  // Audit trail for the cross-currency conversion: what settled, what was expected, what the ledger
  // was credited. Persisted verbatim by append_payment_event into payment_events.payload — zero
  // migration, and a chargeback/VAT question years later can reconstruct the arithmetic.
  const payload = {
    ...(event.raw && typeof event.raw === 'object' ? (event.raw as Record<string, unknown>) : {}),
    _settlement: {
      settledMinor: event.amountMinor ?? null,
      settledCurrency: event.currency ?? null,
      expectedMinor,
      expectedCurrency,
      ledgerCreditMinor: amountMinor,
      ledgerCurrency,
    },
  } as unknown as Json;

  const { data: ledgerRow, error: rpcErr } = await admin.rpc('append_payment_event', {
    p_payment_id: payment.id,
    p_type: event.outcome,
    p_provider_event_id: event.providerReference,
    p_amount_minor: amountMinor,
    p_occurred_at: new Date().toISOString(),
    p_payload: payload,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  // ---- DID THE CREDIT ACTUALLY LAND? A clean error channel is NOT proof of a write.
  //
  // The ledger insert is `on conflict (payment_id, provider_event_id, type) do nothing`, so an event
  // that collides with one already on file writes nothing, credits nothing, and still returns
  // success. That is exactly how a discarded Peach 'Successful' (it reuses the Pending's transaction
  // id) once reported a confirmed booking over an empty ledger: the booking stayed payment_pending,
  // the expiry sweep released it, and the seat was resold with the money taken. The dedup key now
  // carries the event type — but the REPORTING side must stop trusting the provider's outcome string
  // regardless of what caused a shortfall, because `confirmed` is not an internal detail: the
  // /payments/sync poll hands it to the guest's browser, where it drives EmbeddedCheckout's redirect
  // to the confirmation page. It must describe the LEDGER, never the provider's word.
  //
  // Only the 'paid' path is asserted. A refund credit is legitimately 0 (a duplicate refund clamps to
  // `outstanding`), so there is no floor to check without re-deriving the refund arithmetic here.
  if (event.outcome === 'paid') {
    const totals = await ledgerTotals(admin, ledgerRow, payment.id);
    if (!totals || totals.paidMinor < totals.totalMinor) {
      log.error('reconcile_credit_not_applied', {
        bookingRef: event.bookingRef,
        providerReference: event.providerReference,
        creditedMinor: amountMinor,
        ledgerPaidMinor: totals?.paidMinor ?? null,
        ledgerTotalMinor: totals?.totalMinor ?? payment.amount_minor,
        ledgerCurrency,
      });
      // Same remedy as a quarantine, and for the same reason: the money is real, we could not prove
      // it was credited, so the expiry sweep must not release the seat. Never throws — a 5xx would
      // make Peach redeliver an event that will collide identically every time.
      try {
        await admin.rpc('api_flag_settlement_review', {
          p: { paymentId: payment.id, reason: 'credit_not_applied' },
        });
      } catch {
        log.error('reconcile_review_flag_failed', {
          bookingRef: event.bookingRef,
          reason: 'credit_not_applied',
        });
      }
      // The `quarantined:` prefix is the established "settled but not credited" signal: the sweep
      // counts it as errored rather than as a failed payment, the webhook logs it and still ACKs,
      // and the booking stays payment_pending so the re-query paths can self-heal it.
      return { found: true, confirmed: false, outcome: 'quarantined:credit_not_applied' };
    }
  }

  // Captured, but Peach wants a human to vet it (fraud suspicion / AVS mismatch). The money moved,
  // so the booking confirms like any other capture — but the owner must see it before the guest
  // travels, and `settlement_review_at` is exactly the flag run_booking_maintenance already honours.
  // Never allowed to throw: the ledger write above has already succeeded, and a throw here would
  // 5xx the webhook and make Peach redeliver an event we have fully absorbed.
  if (event.needsReview) {
    try {
      await admin.rpc('api_flag_settlement_review', {
        p: { paymentId: payment.id, reason: 'provider_manual_review' },
      });
    } catch {
      log.error('reconcile_review_flag_failed', {
        bookingRef: event.bookingRef,
        reason: 'provider_manual_review',
      });
    }
  }

  // Card-on-file harvest. A customer-present checkout the customer chose to save carries a reusable
  // `registrationId` token in the STATUS payload (never the webhook, so this only ever fires on the
  // sync/cron re-query paths). Store it against the booking owner. Best-effort and LAST: it runs only
  // after the credit has been proven applied above, and a save failure must never fail or unwind a
  // confirmed payment. Inert until Phase 2's store flow sets `allowStoringDetails` — `registrationId`
  // is absent on every checkout that didn't opt in.
  if (event.outcome === 'paid' && event.registrationId && booking.user_id) {
    try {
      await admin.rpc('api_save_card', {
        p: {
          userId: booking.user_id,
          registrationId: event.registrationId,
          brand: event.cardBrand ?? null,
          last4: event.cardLast4 ?? null,
          expMonth: event.cardExpMonth ?? null,
          expYear: event.cardExpYear ?? null,
        },
      });
    } catch {
      log.error('reconcile_save_card_failed', { bookingRef: event.bookingRef });
    }
  }

  return { found: true, confirmed: fullyPaid, outcome: event.outcome };
}
