import { describe, expect, it } from 'vitest';
import {
  buildMerchantTransactionId,
  bookingRefFromMerchantTransactionId,
  generateMerchantTransactionId,
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

/**
 * The GENERATED scheme that replaced the derived one. The derived id is fixed for the life of a
 * payment row, so an id Peach has burned strands that row forever; a generated id is simply reissued
 * on the next attempt. What that costs is traceability — the booking ref is no longer inside the
 * string — which `payment_merchant_refs` buys back.
 */
describe('generateMerchantTransactionId', () => {
  it('is 16 characters, the same shape and length as a booking ref', () => {
    // NOT longer on purpose: the sandbox proved /v2/checkout accepts ≥64 characters when OPENING a
    // session, but 800.100.156 is a decline at the CARD step, which that probe never exercised. 16 is
    // the length we have watched settle in production thousands of times.
    for (let i = 0; i < 200; i += 1) {
      const id = generateMerchantTransactionId();
      expect(id).toHaveLength(16);
      expect(id).toMatch(/^BMT[0-9A-HJKMNP-TV-Z]{13}$/);
    }
  });

  it('never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) seen.add(generateMerchantTransactionId());
    expect(seen.size).toBe(5000);
  });

  it('excludes the characters that are misread when typed back in by hand', () => {
    // Crockford base32: an id is read off the Peach dashboard and typed into the admin search box, so
    // I/L/O/U must not appear — they are the ones confused with 1/1/0/V.
    const ids = Array.from({ length: 500 }, () => generateMerchantTransactionId()).join('');
    expect(ids.slice(3)).not.toMatch(/[ILOU]/);
  });

  it('carries no booking ref, so the parser cannot invent one from it', () => {
    // The parser is tolerant by design (it returns an unrecognised shape untouched), so a generated id
    // comes back as itself. That is exactly why resolution must consult payment_merchant_refs FIRST
    // and only then fall back to the parser.
    const id = generateMerchantTransactionId();
    expect(bookingRefFromMerchantTransactionId(id)).toBe(id);
  });
});
