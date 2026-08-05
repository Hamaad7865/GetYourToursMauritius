import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import {
  pickupQuoteSchema,
  pickupRequestResultSchema,
  type PickupQuote,
  type PickupRequestResult,
  type RequestPickupInput,
} from '@/lib/validation/booking';

/**
 * Late pickup — the guest who booked with "I don't know yet" comes back and finishes the job.
 *
 * Both calls are ownership-gated in SQL (api_quote_pickup_addon / api_request_pickup check
 * `user_id = auth.uid()` or is_staff()), so they run on the CALLER's context, never service-role.
 *
 * NO PRICE CROSSES THE WIRE, in either direction of trust: the client sends coordinates, the server
 * re-derives the region and reads the fare from transport_band_pricing. The number this module
 * returns is for DISPLAY; what the card is actually charged is pinned separately inside
 * api_create_payment against the payments row api_request_pickup wrote.
 */

/**
 * What would a pickup at these coordinates cost? Read-only — dragging a map pin must never mint a
 * payment row, so this is a separate RPC from {@link requestPickup} rather than a dry-run flag on it.
 */
export async function quotePickupAddon(
  ctx: ServiceContext,
  bookingRef: string,
  coords: { pickupLat: number; pickupLng: number },
): Promise<PickupQuote> {
  const data = await callRpc(ctx, 'api_quote_pickup_addon', {
    bookingRef,
    pickupLat: coords.pickupLat,
    pickupLng: coords.pickupLng,
  });
  return pickupQuoteSchema.parse(data);
}

/**
 * Commit to a pickup address.
 *
 * Zero fee → applied to the booking immediately (`applied: true`, nothing to pay).
 * Fee due  → the address is PARKED in booking_pickup_requests behind a 'pickup_addon' payments row
 *            and only reaches the booking when that row settles. The caller takes the returned
 *            paymentId to checkout via createPaymentLink({ purpose: 'pickup_addon' }).
 *
 * Idempotent: calling it again for the same booking revises the open request in place rather than
 * forking a second payable supplement.
 */
export async function requestPickup(
  ctx: ServiceContext,
  bookingRef: string,
  input: RequestPickupInput,
): Promise<PickupRequestResult> {
  const data = await callRpc(ctx, 'api_request_pickup', {
    bookingRef,
    pickupLocation: input.pickupLocation,
    dropoffLocation: input.dropoffLocation ?? null,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
  });
  return pickupRequestResultSchema.parse(data);
}
