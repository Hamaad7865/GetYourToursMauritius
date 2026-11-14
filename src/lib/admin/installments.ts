/**
 * The per-date payment schedule's one question — which installment is NEXT — answered once, for the
 * Bookings drawer's schedule and Today's "Needs you" reminder button. Pure.
 *
 * `coveredEur` is a waterfall over the booking's settled money (src/lib/admin/bookings.ts), so an
 * installment is paid once settlement reaches its running total. Half a cent of slack absorbs the
 * EUR rounding of minor units.
 */

export interface InstallmentLike {
  seq: number;
  /** yyyy-mm-dd. */
  dueOn: string;
  label: string;
  amountEur: number;
  coveredEur: number;
}

/** Settlement has reached this installment's full amount. */
export function installmentPaid(i: Pick<InstallmentLike, 'amountEur' | 'coveredEur'>): boolean {
  return i.coveredEur >= i.amountEur - 0.005;
}

/** The earliest installment not yet fully covered, or null once everything is settled. */
export function nextInstallment<T extends InstallmentLike>(
  installments: readonly T[] | null | undefined,
): T | null {
  return (installments ?? []).find((i) => !installmentPaid(i)) ?? null;
}
