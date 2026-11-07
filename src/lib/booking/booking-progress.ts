/**
 * The three-step tracker on a My bookings card: where the booking is, in the guest's words.
 *
 * Labels are the English keys; the card runs each one through `t()`. A state with nothing to track
 * (expired, failed, a plain cancellation with no money to return) gets no tracker at all rather than
 * a row of empty circles.
 */
export type ProgressState = 'done' | 'current' | 'todo';

export interface ProgressStep {
  label: string;
  state: ProgressState;
}

export interface ProgressInput {
  status: string;
  /** The trip date has gone by (Mauritius calendar day). */
  isPast: boolean;
  /** Confirmed on a deposit with a balance still owed — "Paid" would overstate it. */
  depositOnly: boolean;
}

export function bookingProgress(input: ProgressInput): ProgressStep[] | null {
  switch (input.status) {
    case 'held':
    case 'payment_pending':
      return [
        { label: 'Reserved', state: 'done' },
        { label: 'Payment', state: 'current' },
        { label: 'Confirmed', state: 'todo' },
      ];
    case 'confirmed':
    case 'completed':
      return [
        { label: 'Booked', state: 'done' },
        { label: input.depositOnly ? 'Deposit paid' : 'Paid', state: 'done' },
        {
          label: 'Trip day',
          state: input.status === 'completed' || input.isPast ? 'done' : 'todo',
        },
      ];
    case 'refund_pending':
      return [
        { label: 'Cancelled', state: 'done' },
        { label: 'Refund processing', state: 'current' },
        { label: 'Refunded', state: 'todo' },
      ];
    case 'refunded':
      return [
        { label: 'Cancelled', state: 'done' },
        { label: 'Refund processing', state: 'done' },
        { label: 'Refunded', state: 'done' },
      ];
    default:
      return null;
  }
}
