import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ProviderError,
  ValidationError,
} from './errors';

/**
 * Maps a Postgres exception raised by an `api_*` / booking RPC onto a typed
 * ServiceError. Both transports surface the raised message as `error.message`.
 */
export function mapDbError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  if (/insufficient_capacity/.test(message)) {
    throw new ConflictError('Not enough availability for this selection');
  }
  if (/hold_not_active|hold_not_found/.test(message)) {
    throw new ConflictError('This reservation has expired — please try again');
  }
  if (
    /occurrence_not_bookable|occurrence_not_found|occurrence_in_past|invalid_party|invalid_item|invalid_quantity|unknown_price_tier|exceeds_max_guests|items_quantity_mismatch|invalid_request/.test(
      message,
    )
  ) {
    throw new ValidationError('Invalid booking request', { detail: message });
  }
  if (/forbidden/.test(message)) {
    throw new ForbiddenError();
  }
  if (/booking_not_found|payment_not_found/.test(message)) {
    throw new NotFoundError('Not found');
  }

  console.error('[db] unmapped database error', message);
  throw new ProviderError('Database error');
}
