'use client';

import { useState } from 'react';
import { saveChargeHandoff } from '@/lib/checkout/charge-handoff';
import { startInstallmentPayment } from '@/lib/quotes/installment-pay-client';

/**
 * The Pay button on a durable installment page. It posts NOTHING — the installment token is in the
 * httpOnly cookie scoped to this seq; the route mints a fresh Peach checkout sized to this installment
 * and hands the guest to the existing pay page. The mirror of {@link
 * import('@/components/quotes/QuoteBalancePayButton').QuoteBalancePayButton}; the money-path decisions
 * live in {@link startInstallmentPayment}, the browser side-effects (charge handoff + navigation) here.
 */
export function QuoteInstallmentPayButton({
  quoteRef,
  seq,
  amountLabel,
}: {
  quoteRef: string;
  seq: number;
  /** e.g. "EUR 180.00" — shown on the button so the guest sees the exact charge before clicking. */
  amountLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (busy) return;
    setBusy(true);
    setError(null);

    const outcome = await startInstallmentPayment({ quoteRef, seq });

    if (outcome.kind === 'checkout') {
      if (outcome.charge) saveChargeHandoff({ ref: outcome.bookingRef, ...outcome.charge });
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
        {busy ? 'Starting…' : `Pay ${amountLabel}`}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-coral-dark">
          {error}
        </p>
      )}
    </>
  );
}
