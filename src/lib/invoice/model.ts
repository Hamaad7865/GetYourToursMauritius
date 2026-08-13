import { childSeatsCost } from '@/lib/services/pricing';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/translate';

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
  /**
   * The line's OWN activity title, prefixed to its price label — e.g. "Catamaran Cruise" turns the bare
   * band "Adult" into "Catamaran Cruise — Adult". A converted quote can mix several DIFFERENT tours and
   * self-describing custom lines on one booking, so the prefix has to be per line and not one title for
   * the whole document (the bug that printed every line — the other tours, the transfers, a car rental —
   * under the first tour's name).
   *   - `null`      = a self-describing line that takes NO prefix (a custom/transfer/rental line, whose
   *                   description already says what it is).
   *   - `undefined` = the caller supplies no per-line title, and the line falls back to the booking's
   *                   single {@link InvoiceBookingInput.activityTitle} — the shape every ordinary
   *                   single-activity caller (and its tests) already relies on.
   */
  title?: string | null;
  /** When THIS line happens, ISO string — the catalogue line's departure or the custom line's own
   *  date. Rendered as a per-line date on the document so a multi-day booking shows which day each
   *  line falls on. Null/undefined for a dateless line (a supplement, a transport add-on). */
  when?: string | null;
  /** The attached round-trip transfer's fare in MINOR units (already inside `totalEur`), and the pickup
   *  it collects from. When > 0, buildInvoice emits a NESTED add-on line right under this one so the
   *  document itemises it and the lines still reconcile to the total. Null/absent = no transfer. */
  transportFareMinor?: number | null;
  transportPickupLabel?: string | null;
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
  customerPhone?: string | null;
  currency: string;
  /** Order total in EUR, VAT-inclusive — the authoritative figure the lines must reconcile to. */
  totalEur: number;
  /** Amount still owed in EUR MINOR units (bookings.balance_due_minor). Absent/0 for a fully-paid
   *  booking; > 0 for a deposit-confirmed booking, which turns the document into a RECEIPT. */
  balanceDueMinor?: number | null;
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
  /** The optional supplements, as SNAPSHOT on the booking (booking_supplements): the label the
   *  guest saw, how many they bought, and each charge in EUR (already inside totalEur). Read from
   *  the booking rather than the activity so a reprint survives the owner renaming or re-pricing. */
  supplements?: Array<{ name: string; qty: number; unitEur?: number; totalEur: number }> | null;
  /** Airport-transfer details — present only for transfer bookings; surfaced as a "Transfer details"
   *  block on the voucher/receipt so the driver has everything. All optional/nullable. */
  transfer?: TransferDetails | null;
  items: InvoiceBookingItem[];
  /** The language the guest booked in (bookings.locale, Task 15). Normalized to a valid {@link Locale}
   *  in `buildInvoice` — an absent/unrecognised value falls back to English rather than throwing, since
   *  this rides through an untyped JSON round-trip (the receipt RPC) before it gets here. */
  locale?: Locale | string | null;
}

/** The airport-transfer fields the voucher shows (the driver's run-sheet data). All optional. */
export interface TransferDetails {
  direction?: string | null; // 'arrival' | 'departure' | 'return'
  roomOrCabin?: string | null;
  flightNumber?: string | null;
  arrivalTime?: string | null;
  returnDate?: string | null; // departure/pickup date for the departure leg
  returnTime?: string | null;
  departureFlightNumber?: string | null;
  luggageDetails?: string | null;
  childSeatAge?: number | null;
  travellerCountry?: string | null;
  travellerCompany?: string | null;
  travellerGender?: string | null;
  specialNotes?: string | null;
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
  /** When this line happens, ISO — the departure/date shown under the line. Null for a dateless line. */
  when?: string | null;
  /** True for a transport add-on line nested under its parent tour/custom line — renderers indent it. */
  isAddon?: boolean;
}

export interface InvoiceModel {
  invoiceNumber: string;
  issuedAt: string;
  /** Always a valid {@link Locale} — normalized once here so every renderer can call `translate(locale, …)`
   *  without re-guarding. See {@link InvoiceBookingInput.locale}. */
  locale: Locale;
  business: InvoiceBusiness;
  customer: { name: string; email: string };
  booking: {
    ref: string;
    activityTitle: string;
    when: string;
    pickup?: string | null;
    dropoff?: string | null;
    /** Airport-transfer details (null for non-transfer bookings) — shown as a "Transfer details" block. */
    transfer?: TransferDetails | null;
  };
  lines: InvoiceLine[];
  subtotalNetEur: number;
  vatRatePct: number;
  vatAmountEur: number;
  totalGrossEur: number;
  /** Amount SETTLED so far in EUR (totalGross − balanceDue): the deposit on a receipt, the full total
   *  on an invoice. fxRate divides by THIS, not totalGross, so a 10% deposit's rate is not ~10× wrong. */
  amountPaidEur: number;
  /** Amount still owed in EUR (0 = paid in full). > 0 makes this document a DEPOSIT RECEIPT: the PDF
   *  gates its PAID stamp off and shows "Amount paid / Balance due", the email adopts the receipt copy. */
  balanceDueEur: number;
  /** When true AND balanceDueEur > 0, this is a receipt for an INTERMEDIATE per-date INSTALLMENT (not the
   *  deposit): the email + PDF say "payment received" / "PART PAID" rather than "deposit". Set by the
   *  enrich step from the outbox payload; a plain deposit receipt leaves it false. */
  installment?: boolean;
  currency: string;
  payment: {
    chargedAmount: number;
    chargedCurrency: string;
    /** True when the card was charged in a different currency than the (EUR) invoice — MUR since
     *  2026-07-30. Renderers show the conversion line only when set, so EUR-era documents are
     *  byte-identical to before. */
    isConverted: boolean;
    /** The EFFECTIVE EUR→chargedCurrency rate (chargedAmount / amountPaidEur — the amount THIS charge
     *  settled, NOT the order total). Deliberately derived from the two printed figures rather than
     *  copied from payments.charged_fx_rate, so the arithmetic ON THE DOCUMENT closes exactly even
     *  after the whole-rupee rounding of the pin, AND a deposit charge (which settles a fraction of the
     *  total) divides by the fraction it actually paid rather than the whole order. (MUR is an ISO
     *  exponent-2 currency, so the /100 in chargedAmount stays aligned with the provider boundary.) */
    fxRate: number | null;
    paidAt?: string | null;
    providerRef?: string | null;
  };
}

/**
 * Build the invoice/receipt model from a booking, its payment, and the business identity.
 *
 * Lines: each booking item -> `{ description: '<activityTitle> — <priceLabel>', quantity: pax ?? quantity,
 * unitGrossEur: subtotalEur / qty, lineGrossEur: subtotalEur }`. A "Door-to-door transport" line is
 * appended when `transportEur > 0`, a "Child seats (N)" line when the child-seat extra (via
 * `childSeatsCost`) > 0, and one line per optional supplement bought — each named from the
 * booking's own snapshot, so a reprint survives the owner renaming or re-pricing it. Because every
 * priced component becomes its own line, the lines reconcile to `totalEur` by construction. The
 * supplements are pushed LAST: `voucher-pdf.ts` reads `lines[0].quantity` positionally for its pax count.
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
  // Normalized ONCE here: every renderer trusts `model.locale` to be a real Locale and calls
  // translate(locale, …) without re-guarding. isLocale() rejects anything but 'en'/'fr' (an absent
  // value, or a stray one from the untyped receipt-RPC round-trip) and falls back to English.
  const locale: Locale = isLocale(booking.locale) ? booking.locale : DEFAULT_LOCALE;

  const lines: InvoiceLine[] = booking.items.flatMap((item) => {
    const quantity = item.pax ?? item.quantity;
    const safeQty = quantity || 1;
    const lineGrossEur = round2(item.subtotalEur);
    // The line's OWN title, prefixed to its label. `undefined` = the caller gave no per-line title, so
    // fall back to the booking's single activityTitle (an ordinary single-activity booking, and its
    // tests). `null` = a self-describing line (a custom/transfer/rental line from a quote) that takes NO
    // prefix — its label already says what was sold, and prefixing it with the booking's first tour is
    // the bug that read "Catamaran Cruise — Nissan March". An empty title likewise prints just the label.
    const title = item.title === undefined ? booking.activityTitle : item.title;
    const mainLine: InvoiceLine = {
      description: title ? `${title} — ${item.priceLabel}` : item.priceLabel,
      quantity,
      unitGrossEur: round2(item.subtotalEur / safeQty),
      lineGrossEur,
      when: item.when ?? null,
    };
    // The attached round-trip transfer, itemised as a NESTED line right under its parent — its fare is
    // already inside totalEur (charged on the line), so surfacing it here is what keeps the lines summing
    // to the total and the per-line VAT split correct. Renderers indent an `isAddon` line under its parent.
    const fareMinor = item.transportFareMinor ?? 0;
    if (fareMinor > 0) {
      const fareEur = round2(fareMinor / 100);
      const pickup = item.transportPickupLabel?.trim();
      const addonLine: InvoiceLine = {
        description: pickup ? `Round-trip transfer · from ${pickup}` : 'Round-trip transfer',
        quantity: 1,
        unitGrossEur: fareEur,
        lineGrossEur: fareEur,
        when: null, // the transfer shares its parent's day; no need to repeat the date
        isAddon: true,
      };
      return [mainLine, addonLine];
    }
    return [mainLine];
  });

  const transportEur = booking.transportEur ?? 0;
  if (transportEur > 0) {
    const amount = round2(transportEur);
    lines.push({
      description: translate(locale, 'Door-to-door transport'),
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
      description: translate(locale, 'Child seats ({n})', { n: childSeats }),
      quantity: 1,
      unitGrossEur: amount,
      lineGrossEur: amount,
    });
  }

  // The optional supplements, from the booking's own SNAPSHOT of each name and charge — never from
  // the activity, which the owner may have renamed or re-priced since. Pushed AFTER the item lines
  // because the voucher reads model.lines[0] positionally for its pax count.
  for (const s of booking.supplements ?? []) {
    if (!s || !(s.totalEur > 0) || !s.name) continue;
    const amount = round2(s.totalEur);
    lines.push({
      description: s.qty > 1 ? `${s.name} (${s.qty})` : s.name,
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

  // The deposit split: what is still owed (from bookings.balance_due_minor), and therefore what has
  // actually settled. Clamped into [0, totalGross] so a stray value can never invert the arithmetic.
  // For an ordinary fully-paid booking balanceDue is 0 and amountPaid is the whole total — every
  // downstream figure (fxRate, the PAID stamp, the email copy) is then byte-identical to before.
  const balanceDueEur = Math.min(
    Math.max(round2((booking.balanceDueMinor ?? 0) / 100), 0),
    totalGrossEur,
  );
  const amountPaidEur = round2(totalGrossEur - balanceDueEur);

  return {
    invoiceNumber: booking.ref,
    issuedAt: payment.issuedAt ?? payment.paidAt ?? '',
    locale,
    business,
    customer: { name: booking.customerName, email: booking.customerEmail },
    booking: {
      ref: booking.ref,
      activityTitle: booking.activityTitle,
      when: booking.when,
      pickup: booking.pickupLocation ?? null,
      dropoff: booking.dropoffLocation ?? null,
      transfer: booking.transfer ?? null,
    },
    lines,
    subtotalNetEur,
    vatRatePct: VAT_RATE_PCT,
    vatAmountEur,
    totalGrossEur,
    amountPaidEur,
    balanceDueEur,
    currency: booking.currency,
    payment: buildPaymentBlock(payment, booking.currency, amountPaidEur),
  };
}

/** The payment block, with the cross-currency facts derived once here so renderers stay dumb. */
function buildPaymentBlock(
  payment: InvoicePaymentInput,
  invoiceCurrency: string,
  amountPaidEur: number,
): InvoiceModel['payment'] {
  const chargedAmount = round2(payment.chargedAmountMinor / 100);
  const isConverted =
    payment.chargedCurrency.toUpperCase() !== invoiceCurrency.toUpperCase() && chargedAmount > 0;
  return {
    chargedAmount,
    chargedCurrency: payment.chargedCurrency,
    isConverted,
    // Divide by the EUR amount THIS charge settled, not the order total: a deposit charge is a fraction
    // of the total, so charged/total would report a rate ~1/depositFraction too small. amountPaidEur is
    // the total for a fully-paid booking, so ordinary invoices are unchanged.
    fxRate: isConverted && amountPaidEur > 0 ? chargedAmount / amountPaidEur : null,
    paidAt: payment.paidAt ?? null,
    providerRef: payment.providerRef ?? null,
  };
}
