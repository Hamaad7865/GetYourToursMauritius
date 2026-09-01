import { describe, expect, it } from 'vitest';
import {
  buildMerchantTransactionId,
  bookingRefFromMerchantTransactionId,
} from '@/lib/payments/merchant-ref';

/**
 * Peach refuses a `merchantTransactionId` that already carries a successful transaction — confirmed
 * by their support against two of our real refs ("Order already has an existing successful initial
 * transaction"). Sending the bare booking ref therefore made every SECOND charge on a booking
 * unpayable: quote balances, dated installments, late-pickup supplements and tour-change
 * differences all died at the card step with result code 800.100.156, while first charges were
 * unaffected.
 *
 * The two properties that matter, and that this pins:
 *   1. two payment rows on ONE booking never produce the same id;
 *   2. the booking ref survives the round trip, in BOTH the new and the pre-change shape, because
 *      reconcile, the sync poll and the webhook fallback all resolve the booking from it.
 */
describe('merchantTransactionId', () => {
  const REF = 'BMTDB3C935BB085C';
  const DEPOSIT = '06ea9e86-aafd-4518-82e9-969739877c76';
  const BALANCE = '96eb7f29-ac78-433e-a9ce-b56954697d56';

  it('gives two payment rows on one booking different ids', () => {
    const a = buildMerchantTransactionId(REF, DEPOSIT);
    const b = buildMerchantTransactionId(REF, BALANCE);
    expect(a).not.toBe(b);
    // Both still name the booking, so a payment stays findable from the Peach dashboard.
    expect(a.startsWith(REF)).toBe(true);
    expect(b.startsWith(REF)).toBe(true);
  });

  it('is stable across retries of the same payment row', () => {
    // A declined card retried on the same unpaid row must reuse the id — that row has no successful
    // transaction yet, so Peach allows it, and this is the behaviour that already works in prod.
    expect(buildMerchantTransactionId(REF, BALANCE)).toBe(buildMerchantTransactionId(REF, BALANCE));
  });

  it('stays inside what Peach accepts', () => {
    // /v2/checkout took 64 chars and `-` in the probe; this is 16 + 1 + 8.
    expect(buildMerchantTransactionId(REF, BALANCE)).toHaveLength(25);
    expect(buildMerchantTransactionId(REF, BALANCE)).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it('round-trips the booking ref back out', () => {
    expect(bookingRefFromMerchantTransactionId(buildMerchantTransactionId(REF, BALANCE))).toBe(REF);
  });

  it('still reads a session minted before the change', () => {
    // Those carry the bare ref and must stay confirmable for as long as they live.
    expect(bookingRefFromMerchantTransactionId(REF)).toBe(REF);
    expect(bookingRefFromMerchantTransactionId('QEF07D0D874E9')).toBe('QEF07D0D874E9');
  });

  it('leaves an unrecognised shape alone rather than guessing', () => {
    expect(bookingRefFromMerchantTransactionId('BMT123-notahex')).toBe('BMT123-notahex');
    expect(bookingRefFromMerchantTransactionId('BMT123-0011223')).toBe('BMT123-0011223'); // 7 hex
    expect(bookingRefFromMerchantTransactionId(null)).toBeNull();
  });

  it('falls back to the bare ref when there is no payment id', () => {
    expect(buildMerchantTransactionId(REF)).toBe(REF);
    expect(buildMerchantTransactionId(REF, null)).toBe(REF);
  });
});
