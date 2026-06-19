import { z } from 'zod';
import { bookingSourceSchema, bookingStatusSchema, paymentStateSchema } from './common';

// --- Booking ----------------------------------------------------------------
export const createBookingInputSchema = z.object({
  occurrenceId: z.string().uuid(),
  /** Slug of the activity the client is booking. When set, the server verifies the occurrence
   *  belongs to it and rejects a mismatch (stops a tampered occurrenceId booking another
   *  activity's slot). Optional for backward compatibility. */
  expectedSlug: z.string().min(1).max(120).optional(),
  /** Quantity per price-tier label, e.g. { "Adult": 2, "Child": 1 }. Bounded so an absurd or
   *  overflowing quantity is a clean validation error rather than a DB int overflow. */
  party: z.record(z.string().min(1).max(80), z.number().int().min(0).max(1000)),
  /** Sightseeing vehicle mode only: the customer chose the SUV upgrade (flat price, parties ≤4).
   *  Ignored by every other pricing mode and for parties over the SUV tier. */
  suv: z.boolean().optional(),
  /** A hold reserved earlier (Continue) to reuse at pay, so the spot isn't double-held. */
  holdId: z.string().uuid().optional(),
  /** The customer's chosen route (sightseeing tours). Free + informational; bounded so a tampered
   *  payload is a clean 400, not a DB blowup. nullish (not optional): the checkout always sends
   *  `itinerary: null` when there's no custom route, and `.optional()` rejects an explicit null. */
  itinerary: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        area: z.string().max(120).nullish(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      }),
    )
    .max(30)
    .nullish(),
  /** The customer's pickup location entered at checkout (pickup/sightseeing tours). Informational;
   *  bounded so a tampered payload is a clean 400, not a DB blowup. */
  pickupLocation: z.string().trim().max(200).nullish(),
  /** Pickup coordinates (per_person / per_group activities with pickup). The SERVER re-derives the
   *  region from these and computes the region-based transport fare — they never carry a price.
   *  nullish like pickupLocation (the checkout sends explicit null when there's no pickup). */
  pickupLat: z.number().min(-90).max(90).nullish(),
  pickupLng: z.number().min(-180).max(180).nullish(),
  /** Number of child seats requested. First free, each additional €6 — the charge is computed
   *  server-side; the client value is only the count. Bounded so a tampered payload is a clean 400. */
  childSeats: z.number().int().min(0).max(25).optional(),
  customer: z.object({
    name: z.string().min(1).max(120),
    email: z.string().email(),
    phone: z.string().max(40).nullish(),
  }),
  source: bookingSourceSchema.optional(),
  /** Client-supplied idempotency key; the service generates one if absent. */
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingInputSchema>;

export const bookingItemSchema = z.object({
  priceLabel: z.string(),
  quantity: z.number().int(),
  /** People on board for a vehicle booking (where quantity is the vehicle count = 1). Null for
   *  per-person/per-group lines, where quantity is the headcount. */
  pax: z.number().int().nullable().optional(),
  unitAmountEur: z.number().nonnegative(),
  subtotalEur: z.number().nonnegative(),
  occurrenceId: z.string(),
});

export const bookingSchema = z.object({
  id: z.string(),
  ref: z.string(),
  status: bookingStatusSchema,
  paymentState: paymentStateSchema,
  customerName: z.string(),
  customerEmail: z.string(),
  totalEur: z.number().nonnegative(),
  currency: z.string(),
  source: bookingSourceSchema,
  createdAt: z.string(),
  items: z.array(bookingItemSchema),
  /** The customer's saved route (sightseeing tours), or null/absent for the standard route. */
  customItinerary: z
    .array(
      z.object({
        title: z.string(),
        area: z.string().nullish(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      }),
    )
    .nullish(),
  /** The customer's pickup location, or null/absent if none was provided. */
  pickupLocation: z.string().nullish(),
  /** Child seats on the booking (first free, €6 each extra; the charge is in totalEur). */
  childSeats: z.number().int().nonnegative().nullish(),
  /** Region-based transport add-on charged on this booking (already included in totalEur). */
  transportEur: z.number().nonnegative().nullish(),
  /** Pickup region the transport fare was based on, or null/absent if no transport was added. */
  pickupRegion: z.string().nullish(),
});
export type Booking = z.infer<typeof bookingSchema>;

// --- Hold (reserve the spot on Continue) ------------------------------------
export const createHoldInputSchema = z.object({
  occurrenceId: z.string().uuid(),
  expectedSlug: z.string().min(1).max(120).optional(),
  people: z.number().int().min(1).max(1000),
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type CreateHoldInput = z.infer<typeof createHoldInputSchema>;

export const holdResultSchema = z.object({
  holdId: z.string(),
  quantity: z.number().int(),
  expiresAt: z.string(),
});
export type HoldResult = z.infer<typeof holdResultSchema>;

/** A hold's current lifecycle state, returned by GET /holds/{id} so the cart can reconcile. */
export const holdStatusSchema = z.object({
  holdId: z.string(),
  status: z.string(), // 'active' | 'released' | 'expired' | 'booked'
  expiresAt: z.string().nullable(),
});
export type HoldStatus = z.infer<typeof holdStatusSchema>;

// --- Payment ----------------------------------------------------------------
export const createPaymentInputSchema = z.object({
  bookingRef: z.string().min(3).max(40),
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;

export const paymentLinkSchema = z.object({
  sessionId: z.string(),
  /** Hosted-checkout redirect URL (redirect providers + the dev stub). Absent for embedded checkout. */
  redirectUrl: z.string().optional(),
  /** Embedded-checkout instance id — the browser mounts the Peach widget with this. */
  checkoutId: z.string().optional(),
  provider: z.string(),
});
export type PaymentLink = z.infer<typeof paymentLinkSchema>;

export const syncPaymentInputSchema = z.object({
  /** The provider checkout id to re-query for an authoritative payment status. */
  checkoutId: z.string().min(1).max(64),
});
export type SyncPaymentInput = z.infer<typeof syncPaymentInputSchema>;

/** Internal: what api_create_payment returns (amount + email come from the DB). */
export const paymentCreateResultSchema = z.object({
  paymentId: z.string(),
  amountMinor: z.coerce.number().int(),
  bookingRef: z.string(),
  customerEmail: z.string(),
});

// --- Lead -------------------------------------------------------------------
export const captureLeadInputSchema = z.object({
  name: z.string().min(1).max(120),
  contact: z.string().min(3).max(200),
  interestActivityId: z.string().uuid().optional(),
  source: z.string().max(40).optional(),
  /** Honeypot: a hidden field real users never fill. If present and non-empty, the lead is dropped. */
  company: z.string().max(200).optional(),
});
export type CaptureLeadInput = z.infer<typeof captureLeadInputSchema>;

export const leadSchema = z.object({
  id: z.string(),
  name: z.string(),
  contact: z.string(),
  interestActivityId: z.string().nullable(),
  status: z.enum(['new', 'contacted', 'converted']),
  source: z.string(),
  createdAt: z.string(),
});
export type Lead = z.infer<typeof leadSchema>;
