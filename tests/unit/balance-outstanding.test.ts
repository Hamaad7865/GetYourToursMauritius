import { describe, expect, it } from 'vitest';
import { balanceIsOutstanding } from '@/lib/quotes/deposit';

/**
 * THE GATE ON THE "BALANCE STILL TO PAY" PANEL — the guest's own booking page
 * (src/components/gyg/detail/BookingConfirmation.tsx) and the admin drawer
 * (src/components/admin/AdminBookings.tsx) both ask this one question before printing a money figure.
 *
 * WHAT IT REPLACED, AND WHY A GREEN SUITE MISSED IT. Both screens shipped gated on
 * `balanceDueEur > 0` alone, which reads as "something is owed" and is not. `balance_due_minor` is
 * not a debt — it is the PROJECTION `total - settled`, and it is written in two places that both
 * leave it at the full total with nothing paid:
 *
 *   * api_convert_quote INITIALISES it to `total_minor` (nothing is settled at conversion — see
 *     20260912000000, which is explicit that the deposit is a charge SIZE, not a payment);
 *   * append_payment_event recomputes it after EVERY event, a 'failed' one included, so a declined
 *     card leaves `balance_due = total` on an ordinary booking that has never held any money.
 *
 * Both were live in production when this test was written, and neither is exotic:
 *
 *   BMT4FCD5F744FE07 — quote booking, expired, never paid: deposit 10, balance 100, total 100. The
 *     guest's page told them "Deposit already paid EUR 0.10" and "Balance still to pay EUR 1.00"
 *     beside a EUR 1.00 total. Nothing had ever been charged.
 *   BMTC86162DEA4CCD — an ORDINARY EUR 90.00 booking, card declined, expired: deposit 0, balance
 *     9000, total 9000. It offered to "send a payment link" for a booking that never existed. That
 *     one is not a quotes defect at all — it reached every customer whose card failed.
 *
 * The cases below are those two rows and the states either side of them, so a future re-gate on the
 * bare column fails here rather than in front of a guest.
 */

/** Minor units throughout, exactly as the SQL holds them — the predicate only compares its inputs. */
const row = (deposit: number, balanceDue: number, total: number) => ({
  deposit,
  balanceDue,
  total,
});

describe('balanceIsOutstanding', () => {
  it('is TRUE only once a deposit has settled and left a remainder', () => {
    // BMTFE8B468EC8961 / BMT2D0A9EF6FF61C, the real confirmed shape: 10% of EUR 1.00 taken.
    expect(balanceIsOutstanding(row(10, 90, 100))).toBe(true);
    // A 50% deposit, also live (BMTB7CBB5E565157).
    expect(balanceIsOutstanding(row(50, 50, 100))).toBe(true);
  });

  it('is FALSE on an unpaid quote booking — the balance still equals the whole total', () => {
    // BMT4FCD5F744FE07. `balance == total` is the tell: nothing has been settled, so a "deposit
    // already paid" line would be a claim about money that was never taken.
    expect(balanceIsOutstanding(row(10, 100, 100))).toBe(false);
  });

  it('is FALSE on an ordinary booking whose payment failed', () => {
    // BMTC86162DEA4CCD. `deposit == 0` on its own settles it: only api_convert_quote ever sizes a
    // deposit, so no ordinary booking can reach this panel however its payments went.
    expect(balanceIsOutstanding(row(0, 9000, 9000))).toBe(false);
    // …and not even when a partial refund puts the balance strictly under the total.
    expect(balanceIsOutstanding(row(0, 6000, 9000))).toBe(false);
  });

  it('is FALSE once the balance itself has been paid', () => {
    expect(balanceIsOutstanding(row(10, 0, 100))).toBe(false);
  });

  it('is FALSE when a refunded deposit pushes the balance back up to the total', () => {
    // The deposit settled and was then refunded: `total - settled` returns to `total`, and the guest
    // owes nothing on a booking that is being unwound.
    expect(balanceIsOutstanding(row(10, 100, 100))).toBe(false);
  });

  it('treats a missing key as 0, so a DTO from a database without 20260917000000 shows nothing', () => {
    expect(
      balanceIsOutstanding({ deposit: undefined, balanceDue: undefined, total: undefined }),
    ).toBe(false);
    expect(balanceIsOutstanding({ deposit: null, balanceDue: 90, total: 100 })).toBe(false);
    expect(balanceIsOutstanding({ deposit: 10, balanceDue: null, total: 100 })).toBe(false);
  });

  it('never fires on a zero-total booking, whatever the columns say', () => {
    expect(balanceIsOutstanding(row(10, 10, 0))).toBe(false);
  });
});
