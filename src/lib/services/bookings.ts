import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { NotFoundError } from './errors';
import { bookingSchema, type Booking, type CreateBookingInput } from '@/lib/validation/booking';

/**
 * Create a booking: atomically holds capacity and creates a payment_pending
 * booking via the api_book RPC (prices computed from the DB, never the client).
 * The idempotency key is client-supplied or generated here.
 */
export async function createBooking(
  ctx: ServiceContext,
  input: CreateBookingInput,
): Promise<Booking> {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const data = await callRpc(ctx, 'api_book', {
    occurrenceId: input.occurrenceId,
    expectedSlug: input.expectedSlug ?? null,
    party: input.party,
    suv: input.suv ?? false,
    holdId: input.holdId ?? null,
    itinerary: input.itinerary ?? null,
    pickupLocation: input.pickupLocation ?? null,
    customerName: input.customer.name,
    customerEmail: input.customer.email,
    customerPhone: input.customer.phone ?? null,
    source: input.source ?? 'web',
    idempotencyKey,
  });
  return bookingSchema.parse(data);
}

export async function getBookingStatus(ctx: ServiceContext, ref: string): Promise<Booking> {
  const data = await callRpc(ctx, 'api_get_booking', { ref });
  if (data === null || data === undefined) {
    throw new NotFoundError(`Booking "${ref}" not found`);
  }
  return bookingSchema.parse(data);
}
