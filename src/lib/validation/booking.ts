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
});
export type Booking = z.infer<typeof bookingSchema>;

// --- Payment ----------------------------------------------------------------
export const createPaymentInputSchema = z.object({
  bookingRef: z.string().min(3).max(40),
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;

export const paymentLinkSchema = z.object({
  sessionId: z.string(),
  redirectUrl: z.string(),
  provider: z.string(),
});
export type PaymentLink = z.infer<typeof paymentLinkSchema>;

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
