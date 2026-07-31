import { fmtDate } from '@/lib/admin/format';
import type { AdminTransferDetails, BookingStatus, PaymentState } from '@/lib/admin/bookings';

/* How a booking is PRESENTED in the back office, shared by the Bookings drawer and the Calendar's
 * day sheet.
 *
 * These blocks all encode semantics that are invisible in the raw column and would be a real
 * operational error to get wrong in one place and right in the other:
 *   - a null drop-off WITH a pickup means "same as pickup", not "no drop-off";
 *   - `pickup_pending` means "to be arranged", which is NOT the same as no pickup at all;
 *   - a never-paid booking that has expired or been cancelled must read "Not paid", never the
 *     ledger's literal "Pending" — that misreading is money-still-expected and it has bitten before.
 * One spelling, two screens. */

function titleCaseStatus(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface PillSpec {
  label: string;
  cls: string;
  dot: string;
}

/** Pastel pill: dot + label. */
export function Pill({ p }: { p: PillSpec }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold ${p.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
      {p.label}
    </span>
  );
}

export function statusPill(status: BookingStatus): PillSpec {
  switch (status) {
    case 'confirmed':
      return { label: 'Confirmed', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' };
    case 'completed':
      return { label: 'Completed', cls: 'bg-ink/[0.06] text-ink', dot: 'bg-ink/40' };
    case 'cancelled':
    case 'expired':
    case 'failed':
      return { label: titleCaseStatus(status), cls: 'bg-red-50 text-red-700', dot: 'bg-red-500' };
    case 'refunded':
    case 'refund_pending':
      return {
        label: titleCaseStatus(status),
        cls: 'bg-slate-100 text-slate-600',
        dot: 'bg-slate-400',
      };
    default:
      return { label: titleCaseStatus(status), cls: 'bg-teal/10 text-teal-dark', dot: 'bg-teal' };
  }
}

/** A booking that can no longer be paid. `payment_state` stays 'pending' in the LEDGER sense (no
 *  payment ever happened — it's a cached projection of payment_events), but rendering that as
 *  "Pending" on an expired/cancelled booking reads as money-still-expected. Show "Not paid". */
export function paymentClosed(state: PaymentState, status: BookingStatus): boolean {
  return state === 'pending' && (status === 'expired' || status === 'cancelled');
}

export function paymentPill(state: PaymentState, status: BookingStatus): PillSpec {
  if (paymentClosed(state, status)) {
    return { label: 'Not paid', cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' };
  }
  switch (state) {
    case 'paid':
      return { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' };
    case 'partially_refunded':
    case 'refunded':
      return {
        label: titleCaseStatus(state),
        cls: 'bg-slate-100 text-slate-600',
        dot: 'bg-slate-400',
      };
    case 'failed':
      return { label: 'Failed', cls: 'bg-red-50 text-red-700', dot: 'bg-red-500' };
    default:
      return { label: 'Pending', cls: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' };
  }
}

/** Where to collect the guest and where to leave them. */
export function PickupFacts({
  pickupLocation,
  dropoffLocation,
  pickupPending,
}: {
  pickupLocation: string | null;
  dropoffLocation: string | null;
  pickupPending: boolean;
}) {
  return (
    <dl className="flex flex-col gap-2.5">
      <div>
        <dt className="text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">Pickup</dt>
        <dd className="mt-0.5 text-[13px] text-ink/80">
          {pickupLocation ? (
            pickupLocation
          ) : pickupPending ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Pickup to be arranged
            </span>
          ) : (
            <span className="text-ink-muted">No pickup · customer makes own way</span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">Drop-off</dt>
        <dd className="mt-0.5 text-[13px] text-ink/80">
          {dropoffLocation ? (
            dropoffLocation
          ) : pickupLocation || pickupPending ? (
            // A null drop-off WITH a pickup means "same as pickup", not "no drop-off".
            <span className="text-ink-muted">Same as pickup</span>
          ) : (
            '—'
          )}
        </dd>
      </div>
    </dl>
  );
}

/** Flight numbers, room, luggage — what the driver needs to actually find the guest. */
export function TransferFacts({ transfer }: { transfer: AdminTransferDetails }) {
  const arrival = [transfer.flightNumber, transfer.arrivalTime].filter(Boolean).join(' · ');
  const departure = [
    transfer.departureFlightNumber,
    [transfer.returnDate ? fmtDate(transfer.returnDate) : null, transfer.returnTime]
      .filter(Boolean)
      .join(' '),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
      <dt className="font-semibold text-ink-muted">Trip</dt>
      <dd className="text-ink/80">
        {transfer.direction === 'departure'
          ? 'Departure (hotel → airport)'
          : transfer.direction === 'return'
            ? 'Return (both ways)'
            : 'Arrival (airport → hotel)'}
      </dd>
      {transfer.roomOrCabin && (
        <>
          <dt className="font-semibold text-ink-muted">Room/cabin</dt>
          <dd className="text-ink/80">{transfer.roomOrCabin}</dd>
        </>
      )}
      {arrival && (
        <>
          <dt className="font-semibold text-ink-muted">Arrival</dt>
          <dd className="text-ink/80">{arrival}</dd>
        </>
      )}
      {departure && (
        <>
          <dt className="font-semibold text-ink-muted">Departure</dt>
          <dd className="text-ink/80">{departure}</dd>
        </>
      )}
      {transfer.luggageDetails && (
        <>
          <dt className="font-semibold text-ink-muted">Luggage</dt>
          <dd className="text-ink/80">{transfer.luggageDetails}</dd>
        </>
      )}
      {transfer.childSeatAge != null && (
        <>
          <dt className="font-semibold text-ink-muted">Child seat</dt>
          <dd className="text-ink/80">age {transfer.childSeatAge}</dd>
        </>
      )}
      {transfer.travellerCountry && (
        <>
          <dt className="font-semibold text-ink-muted">Country</dt>
          <dd className="text-ink/80">{transfer.travellerCountry}</dd>
        </>
      )}
      {transfer.travellerCompany && (
        <>
          <dt className="font-semibold text-ink-muted">Company</dt>
          <dd className="text-ink/80">{transfer.travellerCompany}</dd>
        </>
      )}
      {transfer.travellerGender && (
        <>
          <dt className="font-semibold text-ink-muted">Gender</dt>
          <dd className="capitalize text-ink/80">{transfer.travellerGender}</dd>
        </>
      )}
      {transfer.specialNotes && (
        <>
          <dt className="font-semibold text-ink-muted">Notes</dt>
          <dd className="text-ink/80">{transfer.specialNotes}</dd>
        </>
      )}
    </dl>
  );
}
