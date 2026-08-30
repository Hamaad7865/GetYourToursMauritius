/**
 * Staff change-of-tour: move a PAID booking onto a different activity option and settle the price
 * difference. Browser-side client for the RPCs added in 20261006000000.
 *
 * The three flows differ only by the SIGN of the difference, and the UI must not blur them:
 *   difference > 0  a proposal is parked and the target seat held; the booking does not move until
 *                   the guest pays. `applied` comes back false and `paymentId` is set.
 *   difference = 0  applied immediately, no money.
 *   difference < 0  applied immediately, and `refundDueMinor` is what the owner must refund BY HAND
 *                   in Peach before calling {@link recordChangeRefund}.
 *
 * Prices are never sent from here. Every figure below is read back from the server, which re-derives
 * it from activity_option_prices — handbook rule 1.
 */
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { rpcErrorText } from '@/lib/admin/rpc-error';

/** The priced preview of a candidate move, straight from `api_booking_change_quote`. */
export interface BookingChangeQuote {
  bookingId: string;
  fromOptionId: string;
  toOptionId: string;
  toOccurrenceId: string;
  toActivityTitle: string;
  toOptionName: string;
  startsAt: string;
  units: number;
  oldTotalMinor: number;
  newTotalMinor: number;
  differenceMinor: number;
  capacityLeft: number;
}

/** What `api_propose_booking_change` reports back. */
export interface BookingChangeResult {
  requestId: string;
  /** False only for an upgrade waiting on payment. */
  applied: boolean;
  differenceMinor: number;
  oldTotalMinor: number;
  newTotalMinor: number;
  paymentId: string | null;
  expiresAt: string | null;
  /** Positive only on a cheaper move: what the owner owes the guest back. */
  refundDueMinor: number;
}

/** An open or recently-applied change on a booking, for the drawer's status block. */
export interface BookingChangeRequest {
  id: string;
  bookingId: string;
  toOccurrenceId: string;
  oldTotalMinor: number;
  newTotalMinor: number;
  differenceMinor: number;
  paymentId: string | null;
  expiresAt: string | null;
  appliedAt: string | null;
  refundedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
}

/**
 * Price a candidate move without writing anything. Drives the live figure in the picker, so it runs
 * on every date selection — read-only and safe to call repeatedly.
 */
export async function quoteBookingChange(
  bookingId: string,
  occurrenceId: string,
): Promise<BookingChangeQuote> {
  const { data, error } = await getBrowserSupabase().rpc('api_booking_change_quote', {
    p: { bookingId, occurrenceId },
  });
  if (error) throw error;
  return data as unknown as BookingChangeQuote;
}

/**
 * Propose the move. For an upgrade this holds the seat and mints the payment row but changes NOTHING
 * on the booking; for a level or cheaper move the booking moves before this resolves.
 */
export async function proposeBookingChange(
  ref: string,
  occurrenceId: string,
  expiresInHours = 48,
): Promise<BookingChangeResult> {
  const { data, error } = await getBrowserSupabase().rpc('api_propose_booking_change', {
    p: { ref, occurrenceId, expiresInHours },
  });
  if (error) throw error;
  const r = (data ?? {}) as Partial<BookingChangeResult> & { requestId?: string };
  return {
    requestId: r.requestId ?? '',
    applied: r.applied ?? false,
    differenceMinor: r.differenceMinor ?? 0,
    oldTotalMinor: r.oldTotalMinor ?? 0,
    newTotalMinor: r.newTotalMinor ?? 0,
    paymentId: r.paymentId ?? null,
    expiresAt: r.expiresAt ?? null,
    refundDueMinor: r.refundDueMinor ?? 0,
  };
}

/** Cancel an unpaid proposal, returning the held seat to the pool immediately. */
export async function withdrawBookingChange(requestId: string): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_withdraw_booking_change', {
    p: { requestId },
  });
  if (error) throw error;
}

/**
 * Record that the owner has refunded a cheaper move by hand in Peach. Writes the refund through the
 * same ledger path the webhook uses, so `refunded_minor` and the booking roll-up stay correct.
 * Idempotent — a second click is a no-op.
 */
export async function recordChangeRefund(requestId: string): Promise<number> {
  const { data, error } = await getBrowserSupabase().rpc('api_record_change_refund', {
    p: { requestId },
  });
  if (error) throw error;
  const r = (data ?? {}) as { refundedMinor?: number };
  return r.refundedMinor ?? 0;
}

/**
 * The booking's most recent change request, whatever state it is in — the drawer needs the open one
 * to show "waiting on payment", and the applied-but-unrefunded one to show the refund button.
 *
 * The select list is a LITERAL string: a computed one defeats the typed client's column inference and
 * collapses the row type to `never`.
 */
export async function loadBookingChange(bookingId: string): Promise<BookingChangeRequest | null> {
  const { data, error } = await getBrowserSupabase()
    .from('booking_change_requests')
    .select(
      'id, booking_id, to_occurrence_id, old_total_minor, new_total_minor, difference_minor, payment_id, expires_at, applied_at, refunded_at, withdrawn_at, created_at',
    )
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    id: row.id,
    bookingId: row.booking_id,
    toOccurrenceId: row.to_occurrence_id,
    oldTotalMinor: row.old_total_minor,
    newTotalMinor: row.new_total_minor,
    differenceMinor: row.difference_minor,
    paymentId: row.payment_id,
    expiresAt: row.expires_at,
    appliedAt: row.applied_at,
    refundedAt: row.refunded_at,
    withdrawnAt: row.withdrawn_at,
    createdAt: row.created_at,
  };
}

/**
 * Turn a raw change-flow exception into something a staff operator can read and act on.
 *
 * Mirrors `describeRescheduleError`: the DB tokens are the contract, and they arrive on a plain
 * object rather than an Error (see {@link rpcErrorText}). Anything unrecognised degrades to a generic
 * line rather than leaking SQL at an operator.
 */
export function describeChangeError(err: unknown): string {
  const raw = rpcErrorText(err);
  if (/\bchange_price_unavailable\b/.test(raw))
    return 'That tour does not sell the same ticket types as this booking, so it cannot be priced automatically.';
  if (/\bnot_changeable\b/.test(raw))
    return 'This booking cannot be moved — it must be a confirmed, paid, single-option booking, and neither tour may be a private or vehicle option.';
  if (/\bchange_is_noop\b/.test(raw)) return 'This booking is already on that departure.';
  if (/\binsufficient_capacity\b/.test(raw))
    return 'That departure does not have room for this party.';
  if (/\btarget_not_bookable\b/.test(raw)) return 'That departure is not open for booking.';
  if (/\bchange_payment_in_flight\b/.test(raw))
    return 'The guest has a payment open for this change — wait for it to finish, or try again in a few minutes.';
  if (/\bchange_already_applied\b/.test(raw)) return 'That change has already gone through.';
  if (/\bchange_already_paid\b/.test(raw))
    return 'The difference is already paid and is being applied — refresh in a moment.';
  if (/\boccurrence_not_found\b/.test(raw)) return 'That departure no longer exists.';
  if (/\bforbidden\b/.test(raw)) return 'You do not have permission to change bookings.';
  return 'Could not change this booking.';
}
