import {
  BookingNotPayableError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  ValidationError,
} from './errors';

/**
 * Maps a Postgres exception raised by an `api_*` / booking RPC onto a typed
 * ServiceError. Both transports surface the raised message as `error.message`.
 * Raw DB text is never echoed to clients (logged server-side only).
 */
export function mapDbError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  if (/\binsufficient_capacity\b/.test(message)) {
    throw new ConflictError('Not enough availability for this selection');
  }
  if (/\b(hold_not_active|hold_not_found)\b/.test(message)) {
    throw new ConflictError('This reservation has expired — please try again');
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
  if (/\bforbidden\b/.test(message)) {
    throw new ForbiddenError();
  }
  if (/\b(booking_not_found|payment_not_found)\b/.test(message)) {
    throw new NotFoundError('Not found');
  }

  console.error('[db] unmapped database error', message);
  throw new ProviderError('Database error');
}
