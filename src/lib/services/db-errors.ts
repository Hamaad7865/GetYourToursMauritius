import {
  BookingNotPayableError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ProviderError,
  QuoteAlreadyConvertedError,
  RateLimitError,
  SoldOutError,
  ValidationError,
} from './errors';

/**
 * Maps a Postgres exception raised by an `api_*` / booking RPC onto a typed
 * ServiceError. Both transports surface the raised message as `error.message`.
 * Raw DB text is never echoed to clients (logged server-side only).
 */
export function mapDbError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  // A quote's catalogue line could not take its seat (api_convert_quote's hold path). ABOVE the
  // generic capacity branch on purpose — first match wins, and the DETAIL this token carries names
  // create_hold's own refusal, so the order is what keeps a quote from being answered in the cart's
  // words. Same `sold_out` code, because that is what happened; a different MESSAGE, because a quote
  // guest cannot act on "pick another date" — the date was arranged for them, and the person who can
  // re-arrange it is the operator.
  if (/\bquote_seats_unavailable\b/.test(message)) {
    throw new SoldOutError(
      'One of the activities on this quote is no longer available on the date we offered, so we ' +
        'could not take your payment — nothing has been charged. Please message us and we will ' +
        'sort out a new date.',
    );
  }
  if (/\binsufficient_capacity\b/.test(message)) {
    // Distinct `sold_out` code (not generic `conflict`) so the cart can tell a REAL sold-out from the
    // retryable 409s below (idempotency dup-key race, expired hold) and only then drop the line.
    throw new SoldOutError();
  }
  if (/\b(hold_not_active|hold_not_found)\b/.test(message)) {
    throw new ConflictError('This reservation has expired — please try again');
  }
  // Guest review submission (api_submit_guest_review) → single-use token that's missing, already
  // used, or past its window. Same shape as the hold guards above: not a permissions failure.
  if (/\binvalid_or_expired_token\b/.test(message)) {
    throw new ConflictError(
      'This review link is no longer valid — it may have already been used or expired',
    );
  }
  // Already paid / terminal booking — a returning customer must not be re-charged. Distinct 409 code
  // so the checkout client can clear its stale ref and offer a fresh booking.
  if (/\bbooking_not_payable\b/.test(message)) {
    throw new BookingNotPayableError();
  }
  // Non-RAISE Postgres errors (e.g. the idempotency-key race) must become 409, not 500.
  if (/duplicate key value|unique constraint/i.test(message)) {
    throw new ConflictError('This request was already submitted');
  }
  if (
    /\b(occurrence_not_bookable|occurrence_not_found|occurrence_in_past|occurrence_too_soon|occurrence_activity_mismatch|invalid_party|invalid_item|invalid_quantity|unknown_price_tier|exceeds_max_guests|exceeds_vehicle_capacity|items_quantity_mismatch|invalid_request)\b/.test(
      message,
    )
  ) {
    throw new ValidationError('Invalid booking request');
  }
  if (/null value in column|violates (check|not-null|foreign key) constraint/i.test(message)) {
    throw new ValidationError('Invalid request');
  }
  if (/\brate_limited\b/.test(message)) {
    throw new RateLimitError();
  }
  // Customer self-cancel guards (api_cancel_booking) → friendly 409s.
  if (/\bcancellation_window_passed\b/.test(message)) {
    throw new ConflictError('Free cancellation has passed — please message us to cancel.');
  }
  if (/\bnot_cancellable\b/.test(message)) {
    throw new ConflictError('This booking can no longer be cancelled online.');
  }
  // Reschedule guards (api_reschedule_booking) → friendly 409s. These sit ABOVE the generic
  // `forbidden` branch because first match wins. `target_not_bookable` is deliberately distinct from
  // create_hold's `occurrence_not_bookable`, which is already mapped to a generic validation message.
  if (/\breschedule_window_passed\b/.test(message)) {
    throw new ConflictError('Free changes have closed — please message us to move your date.');
  }
  if (/\bnot_reschedulable\b/.test(message)) {
    throw new ConflictError('This booking can no longer be moved online.');
  }
  if (/\boption_mismatch\b/.test(message)) {
    throw new ConflictError(
      'That date is for a different option — please book it as a new activity.',
    );
  }
  if (/\btarget_not_bookable\b/.test(message)) {
    throw new ConflictError('That date is no longer available — please pick another.');
  }
  // Late-pickup guards (api_request_pickup / api_create_payment's add-on branch) → friendly 409s.
  // Above the generic `forbidden` branch because first match wins.
  if (/\bpickup_not_allowed\b/.test(message)) {
    throw new ConflictError('This booking can no longer take a pickup online — please message us.');
  }
  if (/\bpickup_payment_in_flight\b/.test(message)) {
    throw new ConflictError(
      'A payment for your pickup is already open — finish it, or try again in a few minutes.',
    );
  }
  if (/\bpickup_request_not_found\b/.test(message)) {
    throw new ConflictError('Choose your pickup point again — that request is no longer open.');
  }
  // The supplement is already paid for. Reached when a settlement could not be applied (we called the
  // departure off) and the guest presses "Complete payment" again after rescheduling — without this
  // mapping the guard that stops the second charge would surface as a 500 "Database error".
  if (/\bpickup_already_paid\b/.test(message)) {
    throw new ConflictError(
      'Your pickup supplement is already paid — we’re applying it. Refresh in a moment, or message us.',
    );
  }
  if (/\bpickup_incomplete\b/.test(message)) {
    throw new ValidationError('A pickup needs an address and a map location');
  }
  // Quote conversion guards (api_convert_quote) → readable 404/409s. Without these every guard in
  // that function — including the convert-once guard, the only thing standing between a guest and a
  // second payable booking — falls through to the unmapped ProviderError below and reaches the guest
  // as a 500 "Database error", which reads as a broken site and invites the retry loop the guard
  // exists to end. Above the generic `forbidden` branch because first match wins.
  if (/\bquote_not_found\b/.test(message)) {
    throw new NotFoundError('Not found');
  }
  // A DISTINCT code, not the generic `conflict`: the public quote page's Pay button gets several 409s
  // and can only tell "you have already paid for this" from "this offer was withdrawn" by code. With a
  // generic one it shows a guest whose booking already exists the same "we could not start this
  // payment" it shows a real failure — on the screen where they are trying to pay.
  if (/\bquote_already_converted\b/.test(message)) {
    throw new QuoteAlreadyConvertedError(
      'This quote has already been paid for or is being paid — check your email for the booking.',
    );
  }
  if (/\bquote_cancelled\b/.test(message)) {
    throw new ConflictError('This quote has been withdrawn — please message us for a new one.');
  }
  if (/\bquote_expired\b/.test(message)) {
    throw new ConflictError('This quote has expired — please message us for an updated one.');
  }
  // Draft / zero-total: the offer is not finished, so there is nothing honest to charge for yet.
  // `quote_total_mismatch` joins them: the amount charged is copied from quotes.total_minor while the
  // lines are copied separately, and nothing ties the two together, so a total edited away from its
  // lines would charge a figure the itemisation does not support. Same register — the offer is not
  // finished, and only the owner can put it right.
  if (/\b(quote_not_convertible|quote_total_mismatch)\b/.test(message)) {
    throw new ConflictError('This quote is not ready to pay yet — please message us.');
  }
  if (/\bforbidden\b/.test(message)) {
    throw new ForbiddenError();
  }
  if (
    /\b(booking_not_found|payment_not_found|activity_not_found|notification_not_found)\b/.test(
      message,
    )
  ) {
    throw new NotFoundError('Not found');
  }

  console.error('[db] unmapped database error', message);
  throw new ProviderError('Database error');
}
