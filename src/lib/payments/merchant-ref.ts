/**
 * The `merchantTransactionId` we hand Peach, and how to read a booking ref back out of it.
 *
 * WHY THIS EXISTS. We used to send the booking ref alone, so every payment on a booking carried the
 * SAME id. Peach rejects that once one of them has succeeded — confirmed by their support:
 *
 *   "Value 'BMTDB3C935BB085C' is invalid. Order already has an existing successful initial
 *    transaction … please ensure that the merchantTransactionId is unique for all transactions."
 *
 * The customer sees it as result code 800.100.156, "transaction declined (format error)", inside the
 * widget — and because they then close it, the only thing that reaches our ledger is Peach reporting
 * the checkout as abandoned. That is why this failed silently: every follow-on charge (a quote
 * balance, an installment, a late-pickup supplement, a tour-change difference) was unpayable, and
 * nothing in our logs said so. First charges were unaffected, which is why 52 of them succeeded in
 * the same period that all four follow-on charges failed.
 *
 * THE SCHEME: `<bookingRef>-<8 hex of the payment row id>`.
 *
 *   * UNIQUE PER PAYMENT ROW, not per attempt. Peach's rule is about an id that already has a
 *     SUCCESSFUL transaction, and a payment row succeeds at most once — so retries within one
 *     unpaid row keep the same id, which is exactly the behaviour that already works in production
 *     (bookings that retried a declined card and then paid).
 *   * STABLE across those retries, because it is derived from the row id rather than the clock.
 *   * PREFIXED with the booking ref, so it stays greppable in the Peach dashboard and so a booking
 *     can still be found from a payment.
 *
 * Length is not a constraint: /v2/checkout accepts at least 64 characters and `-`, `_` and `.`
 * separators (verified — scripts/sandbox/probe-mtid.mjs). 16 + 1 + 8 = 25.
 */

/** `-` followed by exactly 8 lowercase hex — the suffix {@link buildMerchantTransactionId} appends. */
const SUFFIX = /-[0-9a-f]{8}$/;

/**
 * Build the id for one payment row. Falls back to the bare booking ref when there is no payment id
 * (the stub provider and older tests), which is the pre-existing behaviour.
 */
export function buildMerchantTransactionId(bookingRef: string, paymentId?: string | null): string {
  if (!paymentId) return bookingRef;
  const hex = paymentId.replace(/-/g, '').slice(0, 8).toLowerCase();
  if (hex.length < 8) return bookingRef;
  return `${bookingRef}-${hex}`;
}

/**
 * Read the booking ref back out of whatever Peach echoes at us.
 *
 * Deliberately tolerant of BOTH shapes: sessions minted before this change carry the bare ref, and
 * they stay payable and confirmable for as long as they live. Only a trailing 8-hex suffix is
 * stripped — no booking or quote ref contains a hyphen, so this cannot eat part of a real ref, and
 * an unrecognised shape is returned untouched rather than guessed at.
 */
export function bookingRefFromMerchantTransactionId(value: string | null): string | null {
  if (!value) return null;
  return SUFFIX.test(value) ? value.replace(SUFFIX, '') : value;
}
