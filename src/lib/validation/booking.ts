import { z } from 'zod';
import { bookingSourceSchema, bookingStatusSchema, paymentStateSchema } from './common';

// --- Booking ----------------------------------------------------------------
export const createBookingInputSchema = z.object({
  occurrenceId: z.string().uuid(),
  /** Quantity per price-tier label, e.g. { "Adult": 2, "Child": 1 }. */
  party: z.record(z.string(), z.number().int().nonnegative()),
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
