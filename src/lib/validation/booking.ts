import { z } from 'zod';
import {
  bookingSourceSchema,
  bookingStatusSchema,
  paginationQuerySchema,
  paymentStateSchema,
} from './common';
import { tourImageSchema } from './tours';

/** Latitude in degrees: finite (rejects NaN/Infinity) and within the valid -90..90 range. */
const latSchema = z.number().finite().min(-90).max(90);
/** Longitude in degrees: finite (rejects NaN/Infinity) and within the valid -180..180 range. */
const lngSchema = z.number().finite().min(-180).max(180);

// --- Booking ----------------------------------------------------------------
export const createBookingInputSchema = z.object({
  occurrenceId: z.string().uuid(),
  /** Slug of the activity the client is booking. When set, the server verifies the occurrence
   *  belongs to it and rejects a mismatch (stops a tampered occurrenceId booking another
   *  activity's slot). Optional for backward compatibility. */
  expectedSlug: z.string().min(1).max(120).optional(),
  /** Quantity per price-tier label, e.g. { "Adult": 2, "Child": 1 }. Bounded so an absurd or
   *  overflowing quantity is a clean validation error rather than a DB int overflow. The key count is
   *  capped too (20 ≫ any real activity's tier count) so a padded payload can't make the RPC parse +
   *  loop over an oversized JSONB. */
  party: z
    .record(z.string().min(1).max(80), z.number().int().min(0).max(1000))
    .refine((p) => Object.keys(p).length <= 20, { message: 'Too many price tiers' })
    // Cap the TOTAL head-count too (well above any real single booking): the per-tier + tier-count
    // caps still allow 20 × 1000 = 20,000 heads, which × a high tier price can overflow the int
    // total_minor column (a clean 400 here beats an ungraceful DB 500).
    .refine((p) => Object.values(p).reduce((s, n) => s + n, 0) <= 500, {
      message: 'Party too large',
    }),
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
        lat: latSchema.optional(),
        lng: lngSchema.optional(),
      }),
    )
    .max(30)
    .nullish(),
  /** The customer's pickup location entered at checkout (pickup/sightseeing tours). Informational;
   *  bounded so a tampered payload is a clean 400, not a DB blowup. */
  pickupLocation: z.string().trim().max(200).nullish(),
  /** The customer's drop-off location (its own field — NEVER merged into pickupLocation). Informational;
   *  bounded so a tampered payload is a clean 400, not a DB blowup. */
  dropoffLocation: z.string().trim().max(200).nullish(),
  /** "Pickup to be arranged" (TBD) — distinct from no pickup. Lets admin see a pending pickup that
   *  has no address yet. */
  pickupPending: z.boolean().optional(),
  /** Pickup coordinates. For per_person / per_group activities with pickup the SERVER re-derives the
   *  region from these and computes the region-based transport fare; for a hotel-to-hotel transfer they
   *  give the PICKUP region (region_from_coords) when the end is a free Google Places pick. Never a
   *  client-sent price. nullish like pickupLocation (the checkout sends explicit null when there's none). */
  pickupLat: latSchema.nullish(),
  pickupLng: lngSchema.nullish(),
  /** Hotel-to-hotel transfer: DROP-OFF coordinates from a free Google Places pick. The SERVER derives the
   *  drop-off region from these via region_from_coords — never a client-sent region or price. */
  dropoffLat: latSchema.nullish(),
  dropoffLng: lngSchema.nullish(),
  /** Number of child seats requested. First free, each additional €6 — the charge is computed
   *  server-side; the client value is only the count. Bounded so a tampered payload is a clean 400. */
  childSeats: z.number().int().min(0).max(25).optional(),
  /** Airport transfer: the hotel page slug. The SERVER looks up the destination zone from it and
   *  recomputes the fare — it never trusts a client-sent zone or price. */
  dropoffSlug: z.string().trim().max(120).nullish(),
  /** Airport transfer: the free-text drop-off AREA for the "my hotel isn't listed" path. The SERVER
   *  classifies the zone from it (Zone 2 = near-airport south-east) — never a client-sent price. */
  dropoffArea: z.string().trim().max(120).nullish(),
  /** Hotel-to-hotel transfer: the PICKUP hotel page slug. The SERVER looks up the pickup region from it
   *  and recomputes the band fare — it never trusts a client-sent region or price. */
  pickupSlug: z.string().trim().max(120).nullish(),
  /** Hotel-to-hotel transfer: the free-text PICKUP area for an unlisted pickup. The SERVER classifies
   *  the region from it (area_region) — never a client-sent price. */
  pickupArea: z.string().trim().max(120).nullish(),
  /** Airport transfer trip type (priced). Return = two legs minus the configured discount (server-side). */
  tripType: z.enum(['one_way', 'return']).optional(),
  /** Airport transfer trip DIRECTION (customer-facing). arrival/departure = one leg, return = both. The
   *  server derives the priced tripType from this. */
  tripDirection: z.enum(['arrival', 'departure', 'return']).optional(),
  /** Airport transfer flight details (informational; bounded so a tampered payload is a clean 400). */
  flightNumber: z.string().trim().max(40).nullish(),
  arrivalTime: z.string().trim().max(40).nullish(),
  /** Return-leg details (only meaningful when tripDirection === 'return'). returnDate is an ISO YYYY-MM-DD. */
  returnDate: z.string().trim().max(40).nullish(),
  returnTime: z.string().trim().max(40).nullish(),
  departureFlightNumber: z.string().trim().max(40).nullish(),
  /** Airport-transfer trip extras (informational; bounded). roomOrCabin = hotel room or cruise cabin no.;
   *  luggageDetails = free text; childSeatAge = the child's age when a child seat is requested. */
  roomOrCabin: z.string().trim().max(60).nullish(),
  luggageDetails: z.string().trim().max(300).nullish(),
  childSeatAge: z.number().int().min(0).max(17).nullish(),
  customer: z.object({
    name: z.string().min(1).max(120),
    email: z.string().email(),
    phone: z.string().max(40).nullish(),
    /** Lead-traveller details captured on the airport-transfer form (informational; bounded). */
    gender: z.string().trim().max(20).nullish(),
    company: z.string().trim().max(120).nullish(),
    country: z.string().trim().max(80).nullish(),
    specialNotes: z.string().trim().max(600).nullish(),
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
        lat: latSchema.optional(),
        lng: lngSchema.optional(),
      }),
    )
    .nullish(),
  /** The customer's pickup location, or null/absent if none was provided. */
  pickupLocation: z.string().nullish(),
  /** The customer's drop-off location, or null/absent if none was provided. */
  dropoffLocation: z.string().nullish(),
  /** True when the pickup is "to be arranged" (TBD) rather than a fixed address or no pickup. */
  pickupPending: z.boolean().nullish(),
  /** Child seats on the booking (first free, €6 each extra; the charge is in totalEur). */
  childSeats: z.number().int().nonnegative().nullish(),
  /** Region-based transport add-on charged on this booking (already included in totalEur). */
  transportEur: z.number().nonnegative().nullish(),
  /** Pickup region the transport fare was based on, or null/absent if no transport was added. */
  pickupRegion: z.string().nullish(),
  /** Airport transfer: trip type/direction + flight details (null/absent for non-transfer bookings). */
  tripType: z.string().nullish(),
  tripDirection: z.string().nullish(),
  flightNumber: z.string().nullish(),
  arrivalTime: z.string().nullish(),
  returnDate: z.string().nullish(),
  returnTime: z.string().nullish(),
  departureFlightNumber: z.string().nullish(),
  /** Airport transfer: trip extras + lead-traveller details (null/absent for non-transfer bookings). */
  roomOrCabin: z.string().nullish(),
  luggageDetails: z.string().nullish(),
  childSeatAge: z.number().int().nullish(),
  travellerGender: z.string().nullish(),
  travellerCompany: z.string().nullish(),
  travellerCountry: z.string().nullish(),
  specialNotes: z.string().nullish(),
  /** True when the customer may self-cancel for a refund (confirmed + paid + the trip is >24h away). */
  cancellable: z.boolean().nullish(),
  /** True when the customer may move the booking to another date. Same predicate as `cancellable`. */
  reschedulable: z.boolean().nullish(),
  /**
   * Set only when WE called the departure off. A non-null value with a null `resolvedAt` means the guest
   * still owes us a choice (new date or refund) — and is what unlocks the 24h-window bypass on both.
   */
  disruption: z
    .object({
      reason: z.enum(['weather', 'sea_conditions', 'safety', 'min_group']).catch('weather'),
      occurrenceId: z.string().nullish(),
      declaredAt: z.string().nullish(),
      resolvedAt: z.string().nullish(),
      resolution: z.enum(['rescheduled', 'refunded']).nullish(),
    })
    .nullish(),
  /** Activity slug + option of the booked line — the confirmation page needs both to offer new dates
   *  (the availability endpoint is keyed by slug and its slots are filtered by option). */
  activitySlug: z.string().nullish(),
  activityOptionId: z.string().nullish(),
  /** Total headcount (pax, falling back to quantity). For display — never for a capacity check. */
  partySize: z.coerce.number().int().nonnegative().nullish(),
  /**
   * Total booking UNITS (sum of quantity) — the unit `seatsLeft` and occurrence capacity are measured
   * in. Equals partySize for a per-person option; is 1 for a vehicle/private one whatever the group
   * size. This, not partySize, is what a replacement date must have room for.
   */
  unitsNeeded: z.coerce.number().int().nonnegative().nullish(),
  /** The booking's occurrence date (ISO) — the transfer's arrival/service date, for the run-sheet. */
  serviceDate: z.string().nullish(),
});
export type Booking = z.infer<typeof bookingSchema>;

export const rescheduleBookingInputSchema = z.object({
  occurrenceId: z.string().uuid(),
});
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingInputSchema>;

// --- Booking history ("My Trips") -------------------------------------------
/** One row in the signed-in customer's booking history. A thin summary — full detail stays at
 *  GET /bookings/{ref}. `totalEur` is EUR major units (consistent with the detail endpoint), NOT
 *  the `*Minor` the cart's pending list uses. Reuses the catalogue `heroImage` shape. */
export const bookingSummarySchema = z.object({
  ref: z.string(),
  title: z.string(),
  status: bookingStatusSchema,
  paymentState: paymentStateSchema,
  totalEur: z.number().nonnegative(),
  currency: z.string(),
  startsAt: z.string().nullable(),
  heroImage: tourImageSchema.nullable(),
  createdAt: z.string(),
});
export type BookingSummary = z.infer<typeof bookingSummarySchema>;

/** GET /bookings query: optional booking-status + trip-date window, offset pagination (like /activities). */
export const bookingHistoryQuerySchema = paginationQuerySchema.extend({
  status: bookingStatusSchema.optional(),
  /** Inclusive trip-date window (ISO YYYY-MM-DD), matched against the booking's occurrence date. */
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type BookingHistoryQuery = z.infer<typeof bookingHistoryQuerySchema>;

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
  /** A still-fresh Peach checkout already recorded for this pending payment (a back/reload retry). When
   *  set, the service reuses it instead of minting a SECOND session — closing the double-charge window. */
  existingCheckoutId: z.string().nullish(),
  /** Another request holds the single-flight checkout lease right now (20260812000000). The service
   *  re-checks once, then surfaces checkout_pending (409) for the caller to retry briefly. */
  checkoutPending: z.boolean().nullish(),
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
