'use client';

import { useState } from 'react';
import { saveChargeHandoff } from '@/lib/checkout/charge-handoff';
import { startBalancePayment } from '@/lib/quotes/balance-pay-client';

/**
 * The Pay button on the durable balance page.
 *
 * It posts NOTHING: the balance link token lives in an httpOnly cookie scoped to
 * `/api/v1/quotes/{ref}/balance` (see src/lib/quotes/link-cookie.ts), so the browser attaches the
 * credential and no script on this page ever holds it. The route mints a FRESH Peach balance checkout
 * on the click; this component only hands the guest to the existing pay page with the session id, so
 * the widget, the webhook and the full VAT invoice on balance-clear are all the untouched money path.
 *
 * The mirror of {@link import('@/components/quotes/QuotePayButton').QuotePayButton}, minus the
 * "already converted" branch (there is nothing to convert — the deposit already did). The decisions
 * about what the route's answer MEANS live in {@link startBalancePayment}, testable without a DOM;
 * what stays here is the pair of side effects the browser owns: the sessionStorage charge handoff (so
 * ChargeNotice can state the exact MUR figure on the pay page) and the navigation.
 *
 * Deliberately NOT localised, matching the deposit page and src/lib/email/quote.ts: the balance link
 * the operator sent is English-only, so a French page under it would be the odd half.
 */
export function QuoteBalancePayButton({ quoteRef }: { quoteRef: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (busy) return; // guard against a double-submit
    setBusy(true);
    setError(null);

    const outcome = await startBalancePayment({ quoteRef });

    if (outcome.kind === 'checkout') {
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
    setError(outcome.message);
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy}
        className="inline-flex w-full items-center justify-center rounded-full bg-teal px-6 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60 sm:w-auto"
      >
        {busy ? 'Starting…' : 'Pay balance'}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-coral-dark">
          {error}
        </p>
      )}
    </>
  );
}
