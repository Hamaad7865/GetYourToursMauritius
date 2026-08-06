'use client';

import { useState } from 'react';
import { saveChargeHandoff } from '@/lib/checkout/charge-handoff';
import { startQuotePayment } from '@/lib/quotes/pay-client';

/**
 * The Pay button on the public quote page.
 *
 * It posts NOTHING: the link token lives in an httpOnly cookie scoped to `/api/v1/quotes/{ref}` (see
 * src/lib/quotes/link-cookie.ts), so the browser attaches the credential and no script on this page —
 * ours, GTM's or an injected one — ever holds it. The route converts the quote into a booking and mints
 * the Peach checkout; this component only hands the guest to the existing pay page with the session id,
 * so the widget, the webhook, the confirmation email and the VAT invoice are all the untouched money
 * path.
 *
 * The decisions about what the route's answer MEANS live in {@link startQuotePayment}, which this suite
 * can test without a DOM. What stays here is the pair of side effects the browser owns:
 *
 *  - {@link saveChargeHandoff}, so ChargeNotice can state the exact MUR figure on the pay page. That is
 *    "the one screen where the customer types their card number, so the one place the MUR amount MUST
 *    be stated" — and a guest who was just shown "Total EUR 230.00" must not reach the widget under a
 *    currency-only sentence with no figure at all;
 *  - the navigation itself.
 *
 * Deliberately NOT localised, matching src/lib/email/quote.ts: the quote email the guest just read is
 * English-only, so a French page under an English email would be the odd half. Translating the module
 * is a follow-up that does both together.
 */
export function QuotePayButton({
  quoteRef,
  /** True once `quotes.converted_at` is set — the guest has accepted and a booking exists. */
  converted = false,
}: {
  quoteRef: string;
  converted?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A refusal that is not a fault: the booking already exists. Shown in a calm register, never in red.
  const [note, setNote] = useState<string | null>(null);

  async function pay() {
    if (busy) return; // guard against a double-submit
    setBusy(true);
    setError(null);
    setNote(null);

    const outcome = await startQuotePayment({ quoteRef });

    if (outcome.kind === 'checkout') {
      // The server-pinned card charge (MUR), so the pay page discloses the exact figure rather than
      // only naming the currency.
      if (outcome.charge) {
        saveChargeHandoff({ ref: outcome.bookingRef, ...outcome.charge });
      }
      // `busy` stays true: we are navigating away, so the button must not become clickable again.
      window.location.href = outcome.href;
      return;
    }
    if (outcome.kind === 'redirect') {
      window.location.href = outcome.href;
      return;
    }
    if (outcome.kind === 'converted') {
      setNote(outcome.message);
      setBusy(false);
      return;
    }
    setError(outcome.message);
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy}
        className={
          converted
            ? // Secondary once converted: the re-arm branch of api_convert_quote is a real recovery
              // route for a booking that died unpaid, so the affordance stays — it just stops being the
              // page's headline action.
              'inline-flex w-full items-center justify-center rounded-full border border-teal px-6 py-3 text-sm font-bold text-teal hover:bg-teal/5 disabled:opacity-60 sm:w-auto'
            : 'inline-flex w-full items-center justify-center rounded-full bg-teal px-6 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60 sm:w-auto'
        }
      >
        {busy ? 'Starting…' : converted ? 'Complete payment' : 'Accept & pay'}
      </button>
      {note && (
        <p role="status" className="mt-3 text-[13px] leading-relaxed text-ink-muted">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-coral-dark">
          {error}
        </p>
      )}
    </>
  );
}
