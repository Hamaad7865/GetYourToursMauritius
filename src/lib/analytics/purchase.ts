import { isConfirmedStatus } from '@/lib/checkout/confirm-poll';

/**
 * The GA4 `purchase` event for a website booking, pushed from the booking page the card form returns
 * to. Without it Google Analytics records no bookings at all: `purchase` has been a key event on the
 * property since July 2026, but nothing ever sent one.
 *
 * WHICH VISIT REPORTS. Only one that came back from paying for a NEW booking, marked by
 * {@link NEW_BOOKING_PARAM} on the return URL. `?just_paid=1` cannot be the signal: EmbeddedCheckout
 * adds it only when it could NOT confirm the payment itself, so the usual, confirmed return carries no
 * flag at all. Nor can "the booking page with a paid booking", which is also every later visit from the
 * email link. The marker comes from {@link newBookingPayPath}, used by the checkout and by "Complete
 * payment" on a still-unpaid booking. Balance, late-pickup and tour-change payments, and quotes paid on
 * the /quotes pages, never carry it. The marker is a hint, so the booking the server returns must also
 * read paid and confirmed, and a staff account viewing a guest's booking never reports.
 *
 * Duplicates: the booking reference is the `transaction_id`, and GA4 drops a repeated purchase with the
 * same transaction ID from the same visitor, so a reload of the paid page is not counted twice. That is
 * why nothing is stored in the browser for it.
 *
 * No personal data: the reference and the amount only. `value` is the booking total in euros, a balance
 * still owed on a deposit booking included, so revenue reads as booked value, not cash taken today.
 */
export interface PurchaseView {
  ref: string;
  status: string;
  paymentState: string;
  totalEur: number;
  /** The page carries {@link NEW_BOOKING_PARAM}: the card form for a new booking returned here. */
  newBooking: boolean;
  /** A staff account on another guest's booking. */
  staffView: boolean;
}

/** A type alias, not an interface, so it passes as the dataLayer's `Record<string, unknown>`. */
export type PurchaseEvent = {
  event: 'purchase';
  ecommerce: { transaction_id: string; value: number; currency: 'EUR' };
};

/** The event this view should send, or null when it must not send one. */
export function purchaseEvent(view: PurchaseView): PurchaseEvent | null {
  if (!view.newBooking || view.staffView) return null;
  if (view.paymentState !== 'paid' || !isConfirmedStatus(view.status)) return null;
  // GA4 collapses every purchase with an empty transaction ID into one, and a €0 sale is not a sale.
  if (!view.ref || !(view.totalEur > 0)) return null;
  return {
    event: 'purchase',
    ecommerce: {
      transaction_id: view.ref,
      value: Math.round(view.totalEur * 100) / 100,
      currency: 'EUR',
    },
  };
}

/** The query parameter that marks the return from paying for a new booking. */
export const NEW_BOOKING_PARAM = 'new_booking';

/** Where the pay page sends a new booking's customer back to: its booking page, marked. */
export function newBookingReturnPath(ref: string): string {
  return `/bookings/${encodeURIComponent(ref)}?${NEW_BOOKING_PARAM}=1`;
}

/**
 * The pay page for a new booking's checkout session. The marked return travels as the pay page's
 * existing `?return=` (validated by safeReturnPath), so neither the pay page nor EmbeddedCheckout needs
 * to know about analytics. EmbeddedCheckout appends `&just_paid=1` to it when it must poll.
 */
export function newBookingPayPath(ref: string, checkoutId: string): string {
  const pay = `/bookings/${encodeURIComponent(ref)}/pay?cid=${encodeURIComponent(checkoutId)}`;
  return `${pay}&return=${encodeURIComponent(newBookingReturnPath(ref))}`;
}
