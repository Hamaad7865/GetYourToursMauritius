'use client';

import { useEffect, useState } from 'react';
import { useT, usePreferences } from '@/components/site/PreferencesProvider';
import { formatMur } from '@/lib/money/fx';
import { readChargeHandoff } from '@/lib/checkout/charge-handoff';

/**
 * The charge disclosure on the pay page — the one screen where the customer types their card number,
 * so the one place the MUR amount MUST be stated (prices everywhere else are EUR by design).
 *
 * The exact figure comes from the charge handoff (sessionStorage, written by whichever page called
 * POST /api/v1/payments with the server's pinned amount). When it is absent or stale — a fresh tab,
 * a forwarded link — we say the CURRENCY plainly and nothing else: this component never computes an
 * amount client-side, because a figure that disagrees with the pinned charge by even a rupee is
 * worse than no figure.
 */
export function ChargeNotice({ bookingRef }: { bookingRef: string }) {
  const t = useT();
  const { language: locale } = usePreferences();
  // Read after mount: sessionStorage doesn't exist during SSR, and the server-rendered fallback
  // sentence must match the first client render (hydration).
  const [charge, setCharge] = useState<{
    amountMinor: number;
    totalEurMinor?: number;
    depositEurMinor?: number;
  } | null>(null);

  useEffect(() => {
    const handoff = readChargeHandoff(bookingRef);
    if (handoff && handoff.chargeCurrency === 'MUR') {
      setCharge({
        amountMinor: handoff.chargeAmountMinor,
        totalEurMinor: handoff.totalEurMinor,
        depositEurMinor: handoff.depositEurMinor,
      });
    }
  }, [bookingRef]);

  const euro = (minor: number) => `€${(minor / 100).toFixed(2).replace(/\.00$/, '')}`;

  const line = (() => {
    if (!charge) {
      return t('Your card will be charged in Mauritian rupees (MUR) at today’s rate.');
    }
    const amount = formatMur(charge.amountMinor, locale);
    // A genuine PARTIAL deposit: the MUR figure is only the deposit, so frame it as such — otherwise a
    // €0.10 deposit → MUR ~5 reads like a bad exchange rate rather than a small deposit.
    if (
      charge.totalEurMinor != null &&
      charge.depositEurMinor != null &&
      charge.depositEurMinor > 0 &&
      charge.depositEurMinor < charge.totalEurMinor
    ) {
      return t(
        'You’re paying a {deposit} deposit now — {amount} at today’s rate. The {balance} balance is due later.',
        {
          deposit: euro(charge.depositEurMinor),
          amount,
          balance: euro(charge.totalEurMinor - charge.depositEurMinor),
        },
      );
    }
    if (charge.totalEurMinor != null) {
      return t('Your card will be charged {amount} — the {eur} total converted at today’s rate.', {
        amount,
        eur: euro(charge.totalEurMinor),
      });
    }
    return t('Your card will be charged {amount} at today’s rate.', { amount });
  })();

  return (
    <>
      <p className="mt-2 text-sm text-ink-muted">{line}</p>
      <p className="mt-1 text-[12px] text-ink-muted/80">
        {t('Your bank may apply its own conversion.')}
      </p>
    </>
  );
}
