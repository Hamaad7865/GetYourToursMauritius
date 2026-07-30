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
  const [charge, setCharge] = useState<{ amountMinor: number; totalEurMinor?: number } | null>(
    null,
  );

  useEffect(() => {
    const handoff = readChargeHandoff(bookingRef);
    if (handoff && handoff.chargeCurrency === 'MUR') {
      setCharge({ amountMinor: handoff.chargeAmountMinor, totalEurMinor: handoff.totalEurMinor });
    }
  }, [bookingRef]);

  return (
    <>
      <p className="mt-2 text-sm text-ink-muted">
        {charge
          ? charge.totalEurMinor != null
            ? t('Your card will be charged {amount} — the {eur} total converted at today’s rate.', {
                amount: formatMur(charge.amountMinor, locale),
                eur: `€${(charge.totalEurMinor / 100).toFixed(2).replace(/\.00$/, '')}`,
              })
            : t('Your card will be charged {amount} at today’s rate.', {
                amount: formatMur(charge.amountMinor, locale),
              })
          : t('Your card will be charged in Mauritian rupees (MUR) at today’s rate.')}
      </p>
      <p className="mt-1 text-[12px] text-ink-muted/80">
        {t('Your bank may apply its own conversion.')}
      </p>
    </>
  );
}
