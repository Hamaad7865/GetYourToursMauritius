import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import type { InvoiceBookingInput, InvoicePaymentInput } from '@/lib/invoice/model';

/**
 * Receipt data loader for the notification drain. The `booking_confirmation` row carries only a thin
 * payload, so before we can render the invoice/receipt we re-read the full booking — plus the activity
 * title and occurrence date (joined; not in `booking_json`) and the payment block — via the SECURITY
 * DEFINER `api_booking_receipt` RPC (service_role only; the drain runs behind INTERNAL_TASK_SECRET).
 *
 * One round-trip returns everything `buildInvoice` needs, mapped here into its two input shapes.
 */

const itemSchema = z.object({
  priceLabel: z.string(),
  quantity: z.number(),
  pax: z.number().nullable().optional(),
  subtotalEur: z.number(),
});

const paymentSchema = z
  .object({
    chargedAmountMinor: z.number(),
    chargedCurrency: z.string(),
    paidAt: z.string().nullable().optional(),
    providerRef: z.string().nullable().optional(),
  })
  .nullable();

/** Shape of `api_booking_receipt`: booking_json fields + the joined activityTitle/when + payment block. */
const receiptSchema = z.object({
  ref: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  currency: z.string(),
  totalEur: z.number(),
  activityTitle: z.string().nullable().optional(),
  when: z.string().nullable().optional(),
  pickupLocation: z.string().nullable().optional(),
  dropoffLocation: z.string().nullable().optional(),
  childSeats: z.number().nullable().optional(),
  transportEur: z.number().nullable().optional(),
  items: z.array(itemSchema),
  payment: paymentSchema,
});

export interface ReceiptData {
  booking: InvoiceBookingInput;
  payment: InvoicePaymentInput;
}

/**
 * Load everything `buildInvoice(booking, payment, business)` needs for one booking, as service_role.
 * Throws if the booking can't be read (a null/blank receipt) so the drain lets the send fail and retry
 * rather than mailing a blank confirmation.
 */
export async function loadBookingForReceipt(
  ctx: ServiceContext,
  bookingId: string,
): Promise<ReceiptData> {
  const raw = await callRpc(ctx, 'api_booking_receipt', { bookingId });
  if (raw == null) {
    throw new Error(`booking_receipt: booking ${bookingId} not found`);
  }
  const r = receiptSchema.parse(raw);

  const booking: InvoiceBookingInput = {
    ref: r.ref,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    currency: r.currency,
    totalEur: r.totalEur,
    activityTitle: r.activityTitle ?? '',
    when: r.when ?? '',
    pickupLocation: r.pickupLocation ?? null,
    dropoffLocation: r.dropoffLocation ?? null,
    childSeats: r.childSeats ?? null,
    transportEur: r.transportEur ?? null,
    items: r.items.map((i) => ({
      priceLabel: i.priceLabel,
      quantity: i.quantity,
      pax: i.pax ?? null,
      subtotalEur: i.subtotalEur,
    })),
  };

  // No payment row yet (shouldn't happen for a confirmed booking, but be defensive): fall back to the
  // EUR ledger total so the PAID stamp still shows a figure rather than NaN.
  const payment: InvoicePaymentInput = r.payment
    ? {
        chargedAmountMinor: r.payment.chargedAmountMinor,
        chargedCurrency: r.payment.chargedCurrency,
        paidAt: r.payment.paidAt ?? null,
        providerRef: r.payment.providerRef ?? null,
      }
    : {
        chargedAmountMinor: Math.round(r.totalEur * 100),
        chargedCurrency: r.currency,
        paidAt: null,
        providerRef: null,
      };

  return { booking, payment };
}
