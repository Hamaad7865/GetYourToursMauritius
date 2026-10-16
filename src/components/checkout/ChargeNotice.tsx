'use client';

import { useEffect, useState } from 'react';
import { useT, usePreferences } from '@/components/site/PreferencesProvider';
import { formatMur } from '@/lib/money/fx';
import { readChargeHandoff } from '@/lib/checkout/charge-handoff';
import type { ChargeCurrency } from '@/lib/settings/charge-currency';

/**
 * The charge disclosure on the pay page — the one screen where the customer types their card number,
 * so the one place a MUR amount MUST be stated (prices everywhere else are EUR by design).
 *
 * Which currency: the one this payment was actually PINNED in, from the charge handoff, when there is
 * one — a payment started before the owner flipped the admin switch keeps its currency — and the
 * switch (`chargeCurrency`, read by the page) otherwise. An EUR charge is the price the customer was
 * shown, so it needs no disclosure; only a part-payment (a deposit) is explained.
 *
 * The exact figure comes from the charge handoff (sessionStorage, written by whichever page called
 * POST /api/v1/payments with the server's pinned amount). When it is absent or stale — a fresh tab,
 * a forwarded link — we say the CURRENCY plainly and nothing else: this component never computes an
 * amount client-side, because a figure that disagrees with the pinned charge by even a rupee is
 * worse than no figure.
 */
export function ChargeNotice({
  bookingRef,
  chargeCurrency,
}: {
  bookingRef: string;
  chargeCurrency: ChargeCurrency;
}) {
  const t = useT();
  const { language: locale } = usePreferences();
  // Read after mount: sessionStorage doesn't exist during SSR, and the server-rendered fallback
  // sentence must match the first client render (hydration).
  const [charge, setCharge] = useState<{
    currency: ChargeCurrency;
    amountMinor: number;
    totalEurMinor?: number;
    depositEurMinor?: number;
  } | null>(null);

  useEffect(() => {
    const handoff = readChargeHandoff(bookingRef);
    if (handoff && (handoff.chargeCurrency === 'MUR' || handoff.chargeCurrency === 'EUR')) {
      setCharge({
        currency: handoff.chargeCurrency,
        amountMinor: handoff.chargeAmountMinor,
        totalEurMinor: handoff.totalEurMinor,
        depositEurMinor: handoff.depositEurMinor,
      });
    }
  }, [bookingRef]);

  const euro = (minor: number) => `€${(minor / 100).toFixed(2).replace(/\.00$/, '')}`;

  const currency = charge?.currency ?? chargeCurrency;
  // A genuine PARTIAL deposit (0 < deposit < total): the charge is only part of the price.
  const partialDeposit =
    charge?.totalEurMinor != null &&
    charge.depositEurMinor != null &&
    charge.depositEurMinor > 0 &&
    charge.depositEurMinor < charge.totalEurMinor
      ? { deposit: charge.depositEurMinor, total: charge.totalEurMinor }
      : null;

  if (currency === 'EUR') {
    if (!partialDeposit) return null;
    return (
      <p className="mt-2 text-sm text-ink-muted">
        {t('You’re paying a {deposit} deposit now. The {balance} balance is due later.', {
          deposit: euro(partialDeposit.deposit),
          balance: euro(partialDeposit.total - partialDeposit.deposit),
        })}
      </p>
    );
  }

  const line = (() => {
    if (!charge || charge.currency !== 'MUR') {
      return t('Your card will be charged in Mauritian rupees (MUR) at today’s rate.');
    }
    const amount = formatMur(charge.amountMinor, locale);
    // A genuine PARTIAL deposit: the MUR figure is only the deposit, so frame it as such — otherwise a
    // €0.10 deposit → MUR ~5 reads like a bad exchange rate rather than a small deposit.
    if (partialDeposit) {
      return t(
        'You’re paying a {deposit} deposit now — {amount} at today’s rate. The {balance} balance is due later.',
        {
          deposit: euro(partialDeposit.deposit),
          amount,
          balance: euro(partialDeposit.total - partialDeposit.deposit),
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
