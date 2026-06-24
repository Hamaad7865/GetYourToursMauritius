import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { NotFoundError } from './errors';
import { bookingSchema, type Booking, type CreateBookingInput } from '@/lib/validation/booking';

/** A payment_pending booking surfaced in the cart's "Awaiting payment" section. `holdExpiresAt` is the
 *  live hold's expiry (drives the countdown); null once the seat hold has lapsed. */
export const pendingBookingSchema = z.object({
  ref: z.string(),
  status: z.string(),
  paymentState: z.string(),
  totalMinor: z.number(),
  currency: z.string(),
  createdAt: z.string(),
  holdExpiresAt: z.string().nullable(),
  title: z.string(),
  startsAt: z.string().nullable(),
});
export type PendingBooking = z.infer<typeof pendingBookingSchema>;

/** The caller's own payment_pending bookings + each one's live hold expiry (owner-scoped RPC). */
export async function listMyPendingBookings(ctx: ServiceContext): Promise<PendingBooking[]> {
  const data = await callRpc(ctx, 'api_my_pending_bookings', {});
  return z.array(pendingBookingSchema).parse(data ?? []);
}

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
    dropoffLocation: input.dropoffLocation ?? null,
    pickupPending: input.pickupPending ?? false,
    pickupLat: input.pickupLat ?? null,
    pickupLng: input.pickupLng ?? null,
    childSeats: input.childSeats ?? 0,
    dropoffSlug: input.dropoffSlug ?? null,
    dropoffArea: input.dropoffArea ?? null,
    tripType: input.tripType ?? null,
    tripDirection: input.tripDirection ?? null,
    flightNumber: input.flightNumber ?? null,
    arrivalTime: input.arrivalTime ?? null,
    returnDate: input.returnDate ?? null,
    returnTime: input.returnTime ?? null,
    departureFlightNumber: input.departureFlightNumber ?? null,
    roomOrCabin: input.roomOrCabin ?? null,
    luggageDetails: input.luggageDetails ?? null,
    childSeatAge: input.childSeatAge ?? null,
    travellerGender: input.customer.gender ?? null,
    travellerCompany: input.customer.company ?? null,
    travellerCountry: input.customer.country ?? null,
    specialNotes: input.customer.specialNotes ?? null,
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

const cancelResultSchema = z.object({
  ref: z.string(),
  status: z.string(),
  alreadyCancelled: z.boolean().optional(),
});
export type CancelResult = z.infer<typeof cancelResultSchema>;

/**
 * Customer self-service cancel → refund. Routes the booking to `refund_pending` (frees the seat, notifies
 * the owner) when it's the caller's own confirmed + paid booking and the trip is more than 24h away.
 * `api_cancel_booking` enforces ownership + the 24h window server-side (zero-trust); its typed errors map
 * via `mapDbError` to a friendly 409 (`cancellation_window_passed` / `not_cancellable`). Idempotent.
 */
export async function cancelBooking(ctx: ServiceContext, ref: string): Promise<CancelResult> {
  const data = await callRpc(ctx, 'api_cancel_booking', { ref });
  return cancelResultSchema.parse(data);
}
