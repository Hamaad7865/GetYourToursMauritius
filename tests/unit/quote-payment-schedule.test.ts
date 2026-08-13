import { describe, expect, it } from 'vitest';
import {
  computeQuoteSchedule,
  formatScheduleDate,
  installmentChargeMinor,
} from '@/lib/quotes/payment-schedule';

/**
 * The per-date payment schedule the guest email, the public quote page and the operator preview all
 * derive from — the ONE place that split lives on the app side. A parity test
 * (tests/integration/payment-schedule.test.ts) pins it to api_convert_quote's SQL; these pin its own
 * arithmetic and its Mauritius-local date grouping.
 */
describe('computeQuoteSchedule', () => {
  it('groups lines into one installment per Mauritius-local date, in order', () => {
    const s = computeQuoteSchedule([
      { startsAt: '2026-09-05T06:00:00Z', subtotalMinor: 9000, transportFareMinor: 0 },
      { startsAt: '2026-09-08T06:00:00Z', subtotalMinor: 12000, transportFareMinor: 0 },
      { startsAt: '2026-09-08T07:00:00Z', subtotalMinor: 6000, transportFareMinor: 0 },
    ]);
    expect(s).toEqual([
      { seq: 0, dueOn: '2026-09-05', amountMinor: 9000 },
      { seq: 1, dueOn: '2026-09-08', amountMinor: 18000 }, // the two 8 Sep lines combine
    ]);
  });

  it('folds a null-dated line into the earliest date', () => {
    const s = computeQuoteSchedule([
      { startsAt: '2026-09-05T06:00:00Z', subtotalMinor: 9000, transportFareMinor: 0 },
      { startsAt: null, subtotalMinor: 5000, transportFareMinor: 0 },
      { startsAt: '2026-09-08T06:00:00Z', subtotalMinor: 12000, transportFareMinor: 0 },
    ]);
    expect(s[0]).toEqual({ seq: 0, dueOn: '2026-09-05', amountMinor: 14000 }); // 9000 + the 5000
  });

  it('folds a line transport fare into its date total', () => {
    const s = computeQuoteSchedule([
      { startsAt: '2026-09-05T06:00:00Z', subtotalMinor: 9000, transportFareMinor: 3000 },
    ]);
    expect(s[0]!.amountMinor).toBe(12000);
  });

  it('places a late-evening UTC line on the NEXT Mauritius day (UTC+4, no DST)', () => {
    // 21:00 UTC on the 5th = 01:00 on the 6th in Mauritius → its own installment on the 6th.
    const s = computeQuoteSchedule([
      { startsAt: '2026-09-05T06:00:00Z', subtotalMinor: 9000, transportFareMinor: 0 },
      { startsAt: '2026-09-05T21:00:00Z', subtotalMinor: 5000, transportFareMinor: 0 },
    ]);
    expect(s.map((i) => i.dueOn)).toEqual(['2026-09-05', '2026-09-06']);
  });

  it('returns [] when no line carries a date (the % deposit path)', () => {
    expect(
      computeQuoteSchedule([{ startsAt: null, subtotalMinor: 9000, transportFareMinor: 0 }]),
    ).toEqual([]);
  });

  it('excludes a zero-amount date so seq 0 is the first PAYABLE date', () => {
    // A complimentary activity on the earliest date must not become a €0 seq-0 (which would collide with
    // create_payment's "no deposit" sentinel and bill the whole total). It is simply not an installment.
    const s = computeQuoteSchedule([
      { startsAt: '2026-09-05T06:00:00Z', subtotalMinor: 0, transportFareMinor: 0 }, // free, earliest
      { startsAt: '2026-09-08T06:00:00Z', subtotalMinor: 30000, transportFareMinor: 0 },
      { startsAt: '2026-09-11T06:00:00Z', subtotalMinor: 20000, transportFareMinor: 0 },
    ]);
    expect(s).toEqual([
      { seq: 0, dueOn: '2026-09-08', amountMinor: 30000 }, // the first POSITIVE date is the deposit
      { seq: 1, dueOn: '2026-09-11', amountMinor: 20000 },
    ]);
  });

  it('sums to exactly the lines total — no cent lost or invented', () => {
    const lines = [
      { startsAt: '2026-09-05T06:00:00Z', subtotalMinor: 3333, transportFareMinor: 111 },
      { startsAt: '2026-09-08T06:00:00Z', subtotalMinor: 6667, transportFareMinor: 222 },
    ];
    const scheduleTotal = computeQuoteSchedule(lines).reduce((a, i) => a + i.amountMinor, 0);
    const lineTotal = lines.reduce((a, l) => a + l.subtotalMinor + l.transportFareMinor, 0);
    expect(scheduleTotal).toBe(lineTotal);
  });
});

describe('formatScheduleDate', () => {
  it('formats yyyy-mm-dd as the "FMDD Mon YYYY" label booking_installments stores', () => {
    expect(formatScheduleDate('2026-09-05')).toBe('5 Sep 2026');
    expect(formatScheduleDate('2026-12-25')).toBe('25 Dec 2026');
  });
});

describe('installmentChargeMinor', () => {
  // Christophe: €616 total, €308 deposit settled → the pay link / reminder for each seq collects the
  // running total up to it, minus what is settled, clamped to the balance.
  const INSTALLMENTS = [
    { seq: 0, amountMinor: 9000 },
    { seq: 1, amountMinor: 29000 },
    { seq: 2, amountMinor: 3000 },
    { seq: 3, amountMinor: 17000 },
    { seq: 4, amountMinor: 3600 },
  ];
  const charge = (seq: number) => installmentChargeMinor(INSTALLMENTS, seq, 61600, 30800);

  it('returns 0 for an installment already covered by settlement (the deposit)', () => {
    expect(charge(0)).toBe(0); // 2 Sep — inside the €308 already paid
  });

  it('charges the running total up to the installment minus what is settled', () => {
    expect(charge(1)).toBe(7200); // 4 Sep: cumulative 38000 − 30800 settled = 7200
    expect(charge(2)).toBe(10200); // 6 Sep: cumulative 41000 − 30800 = 10200 (clears 4 Sep too)
    expect(charge(3)).toBe(27200); // 8 Sep: cumulative 58000 − 30800
  });

  it('never exceeds the balance still owed', () => {
    expect(charge(4)).toBe(30800); // 9 Sep: cumulative 61600 − 30800 = 30800 = the whole balance
  });
});
