import { describe, expect, it } from 'vitest';
import { needsManualReview, outcomeFor } from '@/lib/payments/peach';

/**
 * Peach's own published classification (developer.peachpayments.com/docs/dashboard-response-codes):
 *
 *   successful                 /^(000\.000\.|000\.100\.1|000\.[36]|000\.400\.[1][12]0)/
 *   successful, manual review  /^(000\.400\.0[^3]|000\.400\.100)/
 *   pending                    /^(000\.200)/ plus the long-life-cycle families 800.400.5* / 100.400.500
 *
 * outcomeFor recognised only `000.000.`/`000.100.1` as success and only `000.200` as pending, so
 * every other family above fell through to 'failed' — a CAPTURED payment written to the ledger as a
 * failure, leaving the customer charged with an unconfirmed booking.
 */
describe('outcomeFor: successful captures', () => {
  it.each([
    ['000.000.000', 'transaction succeeded'],
    ['000.000.100', 'successful request'],
    ['000.100.110', 'request successfully processed (test mode)'],
    ['000.300.000', 'two-step transaction succeeded'],
    ['000.310.100', 'account updated'],
    ['000.600.000', 'transaction succeeded due to external update'],
    ['000.400.110', 'authenticated by merchant, no liability shift'],
    ['000.400.120', 'authenticated, no liability shift'],
  ])('treats %s (%s) as paid', (code) => {
    expect(outcomeFor(code, null)).toBe('paid');
  });

  it('maps a successful REFUND payment type to refunded, not paid', () => {
    expect(outcomeFor('000.000.000', 'RF')).toBe('refunded');
    expect(outcomeFor('000.300.000', 'RF')).toBe('refunded');
  });
});

describe('outcomeFor: captured but flagged for manual review', () => {
  // Peach's note on this family is that the transaction WAS charged and needs verification before
  // fulfilment. Recording it as a failure took the money and gave the customer nothing.
  it.each(['000.400.000', '000.400.010', '000.400.020', '000.400.100'])(
    'settles %s as paid',
    (code) => {
      expect(outcomeFor(code, null)).toBe('paid');
      expect(needsManualReview(code)).toBe(true);
    },
  );

  // The [^3] in the regex: 000.400.03* is REJECTED for risk, not captured.
  it.each(['000.400.030', '000.400.039'])(
    'still rejects %s (risk decline, not a capture)',
    (code) => {
      expect(outcomeFor(code, null)).toBe('failed');
      expect(needsManualReview(code)).toBe(false);
    },
  );

  it('does not flag a plain success for review', () => {
    expect(needsManualReview('000.000.000')).toBe(false);
    expect(needsManualReview(null)).toBe(false);
  });
});

describe('outcomeFor: pending', () => {
  it('treats the short-lived widget session as pending', () => {
    expect(outcomeFor('000.200.000', null)).toBe('pending');
    expect(outcomeFor('000.200.100', null)).toBe('pending');
  });

  // Documented as "pending confirmation from external systems"; can stay unresolved for days.
  // Calling these failed both lost the payment and latched the booking out of every recovery path.
  it.each(['800.400.500', '800.400.501', '100.400.500'])('treats %s as pending', (code) => {
    expect(outcomeFor(code, null)).toBe('pending');
  });
});

describe('outcomeFor: genuine failures still fail', () => {
  it.each([
    ['800.100.151', 'invalid card'],
    ['800.100.152', 'declined by authorisation system'],
    ['100.396.101', 'cancelled by user'],
    ['800.120.100', 'too many transactions'],
    ['900.100.300', 'timeout at connector'],
  ])('treats %s (%s) as failed', (code) => {
    expect(outcomeFor(code, null)).toBe('failed');
  });

  it('returns unknown when the provider reports no code at all', () => {
    expect(outcomeFor(null, null)).toBe('unknown');
  });
});
