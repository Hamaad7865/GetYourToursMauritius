'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { PayProgress } from './PayProgress';
import {
  SESSION_COMPLETE_PERCENT,
  clearPayHandoff,
  savePayHandoff,
} from '@/lib/checkout/pay-progress';
import { saveChargeHandoff } from '@/lib/checkout/charge-handoff';

/**
 * Resume payment for an existing, unpaid booking — the recovery path for a customer who returns via
 * the confirmation-email link, a new tab, or their bookings list with a `payment_pending` booking.
 *
 * A checkout session (`cid`) is minted ONLY by POST /api/v1/payments; the pay page can't mount the
 * Peach widget without one. The normal flow gets it from Checkout.pay(); a returning customer never
 * passes through that, so here we re-POST (owner-authed, same body as Checkout.pay's pay step) to mint
 * a FRESH checkout, then hand the customer to /bookings/{ref}/pay?cid=… (or the hosted redirectUrl).
 *
 * The idempotency key is fresh per attempt: unlike the create-booking step, minting a checkout for an
 * already-existing booking is safe to repeat, and a returning customer has no stable key to reuse.
 *
 * `booking_not_payable` (409) — the booking is already paid or terminal — is surfaced as a friendly,
 * non-alarming message rather than a hard error, mirroring Checkout.pay().
 */
export function useResumePayment(
  bookingRef: string,
  /** Which money to reopen. 'pickup_addon' resumes the transport supplement for a late pickup — a
   *  separate payments row on the same booking, so the booking's own already-paid state is no
   *  obstacle (api_create_payment scopes its guards by purpose). */
  purpose?: 'booking' | 'pickup_addon',
  /** EUR deposit + total for a genuine PARTIAL deposit (0 < deposit < total). When present, the pay
   *  page discloses "€X deposit now, €Y balance later" instead of a bare MUR figure that can read like
   *  a bad exchange rate. A full charge leaves this undefined. */
  deposit?: { depositEurMinor: number; totalEurMinor: number },
) {
  const { session } = useAuth();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the booking is already paid / no longer payable: callers can show a softer, terminal note.
  const [notPayable, setNotPayable] = useState(false);

  const resume = useCallback(async () => {
    if (busy) return; // guard against a double-submit
    if (!session) {
      setError(t('Please sign in to complete your payment.'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotPayable(false);
    // Same multi-second provider round-trip as the checkout page's pay step, so it gets the same
    // ring — starting at the session stage, since the booking already exists here.
    clearPayHandoff();
    try {
      const start = () =>
        fetch('/api/v1/payments', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            bookingRef,
            idempotencyKey: crypto.randomUUID(),
            ...(purpose ? { purpose } : {}),
          }),
        }).then((r) => r.json());

      let res = await start();
      // checkout_pending: another tab/request is mid-way creating this booking's Peach session (the
      // single-flight lease). The winner records it within seconds; retry briefly and reuse it.
      for (let retry = 0; !res.ok && res.error?.code === 'checkout_pending' && retry < 3; retry++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        res = await start();
      }

      if (!res.ok) {
        if (res.error?.code === 'booking_not_payable') {
          setNotPayable(true);
          setError(t('This booking is already paid or has expired.'));
          setBusy(false);
          return;
        }
        throw new Error(res.error?.message ?? t('Could not start payment.'));
      }

      const link = res.data as {
        checkoutId?: string;
        redirectUrl?: string;
        chargeAmountMinor?: number;
        chargeCurrency?: string;
      };
      if (link.checkoutId) {
        // Embedded Peach checkout: the pay page mounts the widget from this id. (Leave `busy` true —
        // we're navigating away, so the button stays disabled until the page unloads.)
        // Hand the ring's position over so the pay page continues it instead of restarting.
        savePayHandoff(SESSION_COMPLETE_PERCENT, Date.now());
        // And the server-pinned card charge (MUR), so the pay page discloses the exact figure. For a
        // genuine PARTIAL deposit, carry the EUR deposit + total too, so the pay page can frame that
        // MUR figure as the deposit (a €0.10 deposit → MUR ~5 reads like a bad rate without it).
        if (typeof link.chargeAmountMinor === 'number' && link.chargeCurrency) {
          const depositFields =
            deposit &&
            deposit.depositEurMinor > 0 &&
            deposit.depositEurMinor < deposit.totalEurMinor
              ? { depositEurMinor: deposit.depositEurMinor, totalEurMinor: deposit.totalEurMinor }
              : {};
          saveChargeHandoff({
            ref: bookingRef,
            chargeCurrency: link.chargeCurrency,
            chargeAmountMinor: link.chargeAmountMinor,
            ...depositFields,
          });
        }
        window.location.href = `/bookings/${bookingRef}/pay?cid=${encodeURIComponent(link.checkoutId)}`;
      } else if (link.redirectUrl) {
        // Hosted redirect (and the dev stub).
        window.location.href = link.redirectUrl;
      } else {
        throw new Error(t('Could not start payment.'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not start payment.'));
      setBusy(false);
      clearPayHandoff();
    }
  }, [busy, session, bookingRef, purpose, deposit, t]);

  return { resume, busy, error, notPayable };
}

/**
 * Button wrapper around {@link useResumePayment}. Renders its own inline error (the already-paid
 * message included). Drop it anywhere a `payment_pending` booking needs a working "pay" affordance.
 */
export function ResumePaymentButton({
  bookingRef,
  label,
  className,
  depositMinor,
  totalMinor,
}: {
  bookingRef: string;
  /** CTA text — defaults to the shared "Complete payment" string. */
  label?: string;
  className?: string;
  /** EUR deposit + total (minor units) for a PARTIAL-deposit booking, so the pay page can disclose the
   *  deposit/balance split. Pass both; a full charge (deposit 0 or == total) discloses nothing extra. */
  depositMinor?: number;
  totalMinor?: number;
}) {
  const t = useT();
  const deposit =
    depositMinor != null && totalMinor != null
      ? { depositEurMinor: depositMinor, totalEurMinor: totalMinor }
      : undefined;
  const { resume, busy, error } = useResumePayment(bookingRef, undefined, deposit);

  return (
    <>
      <button
        type="button"
        onClick={() => void resume()}
        disabled={busy}
        className={
          className ??
          'inline-flex items-center justify-center rounded-full bg-teal px-4 py-2 text-[13px] font-bold text-white hover:bg-teal-dark disabled:opacity-60'
        }
      >
        {busy ? t('Starting…') : (label ?? t('Complete payment'))}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] font-medium text-coral">
          {error}
        </p>
      )}
      {/* No `booking` stage here: the booking already exists, so the wait is purely the provider
          opening a checkout session. */}
      <PayProgress stage={busy && !error ? 'session' : null} />
    </>
  );
}
