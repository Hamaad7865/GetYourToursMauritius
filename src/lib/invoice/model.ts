import { childSeatsCost } from '@/lib/services/pricing';

/**
 * Pure invoice/receipt model. No I/O, no Date.now()/new Date() — the timestamp is supplied by the
 * caller so tests stay deterministic. The PDF (Task 3) and HTML email (Task 4) renderers consume the
 * shape this builds.
 *
 * VAT: the customer's prices ALREADY include 15% VAT (Mauritius). We therefore back out the tax from
 * the gross total — net = gross / 1.15, vat = gross − net — rather than adding it on top.
 *
 * Money: EUR figures are kept as 2-decimal major units throughout. The payment block's charged amount
 * arrives in MINOR units (the `payments.charged_amount_minor` column from Task 1) and is converted to
 * major units here.
 */

/** Standard Mauritius VAT rate (percent), applied inclusively. */
const VAT_RATE_PCT = 15;

/** Round a major-unit EUR amount to 2 decimals (cent precision), avoiding binary-float drift. */
function round2(amountEur: number): number {
  return Math.round(amountEur * 100) / 100;
}

/** One booking item as it appears in `booking_json` / `bookingSchema` (only the fields the model needs). */
export interface InvoiceBookingItem {
  priceLabel: string;
  quantity: number;
  /** Headcount for a vehicle booking (quantity = 1 vehicle); null for per-person/per-group lines. */
  pax?: number | null;
  /** Line total in EUR, VAT-inclusive (already what the customer was charged for this line). */
  subtotalEur: number;
}

/**
 * Everything `buildInvoice` needs from the booking. Mirrors `booking_json` / `bookingSchema` EXCEPT
 * `activityTitle` + `when` (the occurrence date/time), which `booking_json` does not carry — the caller
 * (Task 6) joins the activity + occurrence and supplies them.
 */
export interface InvoiceBookingInput {
  ref: string;
  customerName: string;
  customerEmail: string;
  currency: string;
  /** Order total in EUR, VAT-inclusive — the authoritative figure the lines must reconcile to. */
  totalEur: number;
  /** Activity title (NOT in booking_json; the caller supplies it). */
  activityTitle: string;
  /** Occurrence date/time, ISO string (NOT in booking_json; the caller supplies it). */
  when: string;
  pickupLocation?: string | null;
  dropoffLocation?: string | null;
  /** Child-seat count; the first seat is free, each extra is €6 (see childSeatsCost). */
  childSeats?: number | null;
  /** Region-based transport add-on in EUR (booking_json's `transportEur`), already inside totalEur. */
  transportEur?: number | null;
  items: InvoiceBookingItem[];
}

/**
 * Payment block input. `chargedAmountMinor` is the raw `payments.charged_amount_minor` (minor units,
 * e.g. 12500 = $125.00) persisted in Task 1; the model converts it to major units in `chargedAmount`.
 */
export interface InvoicePaymentInput {
  chargedAmountMinor: number;
  chargedCurrency: string;
  /** When the card was charged (ISO). Doubles as the invoice issue date when no `issuedAt` is given. */
  paidAt?: string | null;
  providerRef?: string | null;
  /** Optional explicit issue date (ISO); falls back to `paidAt`. */
  issuedAt?: string | null;
}

/** Business identity (the SITE block). */
export interface InvoiceBusiness {
  legalName: string;
  brn: string;
  vat: string;
  street: string;
  locality: string;
  region: string;
  country: string;
  email: string;
  phone: string;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitGrossEur: number;
  lineGrossEur: number;
}

export interface InvoiceModel {
  invoiceNumber: string;
  issuedAt: string;
  business: InvoiceBusiness;
  customer: { name: string; email: string };
  booking: {
    ref: string;
    activityTitle: string;
    when: string;
    pickup?: string | null;
    dropoff?: string | null;
  };
  lines: InvoiceLine[];
  subtotalNetEur: number;
  vatRatePct: number;
  vatAmountEur: number;
  totalGrossEur: number;
  currency: string;
  payment: {
    chargedAmount: number;
    chargedCurrency: string;
    paidAt?: string | null;
    providerRef?: string | null;
  };
}

/**
 * Build the invoice/receipt model from a booking, its payment, and the business identity.
 *
 * Lines: each booking item -> `{ description: '<activityTitle> — <priceLabel>', quantity: pax ?? quantity,
 * unitGrossEur: subtotalEur / qty, lineGrossEur: subtotalEur }`. A "Door-to-door transport" line is
 * appended when `transportEur > 0`, and a "Child seats (N)" line when the child-seat extra (via
 * `childSeatsCost`) > 0. Because every priced component of the booking (items + transport + child seats)
 * becomes its own line, the lines reconcile to `totalEur` by construction.
 *
 * VAT-inclusive split: net is computed per line (round(lineGross / 1.15) to cents) and summed, so the
 * displayed net never drifts from the per-line figures; vat = totalGross − net; vatRatePct = 15.
 *
 * Pure: no Date.now()/new Date(). `issuedAt` is taken from `payment.issuedAt ?? payment.paidAt` — the
 * caller controls the timestamp.
 */
export function buildInvoice(
  booking: InvoiceBookingInput,
  payment: InvoicePaymentInput,
  business: InvoiceBusiness,
): InvoiceModel {
  const lines: InvoiceLine[] = booking.items.map((item) => {
    const quantity = item.pax ?? item.quantity;
    const safeQty = quantity || 1;
    const lineGrossEur = round2(item.subtotalEur);
    return {
      description: `${booking.activityTitle} — ${item.priceLabel}`,
      quantity,
      unitGrossEur: round2(item.subtotalEur / safeQty),
      lineGrossEur,
    };
  });

  const transportEur = booking.transportEur ?? 0;
  if (transportEur > 0) {
    const amount = round2(transportEur);
    lines.push({
      description: 'Door-to-door transport',
      quantity: 1,
      unitGrossEur: amount,
      lineGrossEur: amount,
    });
  }

  const childSeats = booking.childSeats ?? 0;
  const childSeatEur = childSeatsCost(childSeats);
  if (childSeatEur > 0) {
    const amount = round2(childSeatEur);
    lines.push({
      description: `Child seats (${childSeats})`,
      quantity: 1,
      unitGrossEur: amount,
      lineGrossEur: amount,
    });
  }

  // VAT-inclusive: back the tax out of the gross. Net is summed per line (each rounded to cents) so the
  // displayed subtotal stays consistent with the line figures; the residual is the VAT.
  const totalGrossEur = round2(booking.totalEur);
  const subtotalNetEur = round2(
    lines.reduce((net, line) => net + round2(line.lineGrossEur / (1 + VAT_RATE_PCT / 100)), 0),
  );
  const vatAmountEur = round2(totalGrossEur - subtotalNetEur);

  return {
    invoiceNumber: booking.ref,
    issuedAt: payment.issuedAt ?? payment.paidAt ?? '',
    business,
    customer: { name: booking.customerName, email: booking.customerEmail },
    booking: {
      ref: booking.ref,
      activityTitle: booking.activityTitle,
      when: booking.when,
      pickup: booking.pickupLocation ?? null,
      dropoff: booking.dropoffLocation ?? null,
    },
    lines,
    subtotalNetEur,
    vatRatePct: VAT_RATE_PCT,
    vatAmountEur,
    totalGrossEur,
    currency: booking.currency,
    payment: {
      chargedAmount: round2(payment.chargedAmountMinor / 100),
      chargedCurrency: payment.chargedCurrency,
      paidAt: payment.paidAt ?? null,
      providerRef: payment.providerRef ?? null,
    },
  };
}
