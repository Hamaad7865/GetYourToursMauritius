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

/** How the pickup reads: nothing, "to be arranged", or an address (which for a round-trip transfer
 *  is captioned as one). */
export type PickupView =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'text'; text: string; roundTrip: boolean };
/** How the drop-off reads: a dash (no pickup at all), "same as pickup", or a distinct address. */
export type DropoffView = { kind: 'dash' } | { kind: 'same' } | { kind: 'text'; text: string };

/**
 * ONE reading of "where do we collect this guest, and where do we leave them", shared by the day sheet
 * and the bookings drawer so they can never disagree about the same driver's pickup.
 *
 * A round-trip TRANSPORT add-on (`transportPickup`) IS the pickup when the booking carries no explicit
 * pickup of its own — a quote-converted booking has its hotel only on the line's transfer — and a round
 * trip returns to that same place. Before this, the day sheet rendered the booking's own null pickup as
 * "No pickup · customer makes own way" and "Drop-off: —" while ALSO printing a "Round-trip transfer"
 * line beneath: a flat contradiction the operator reported. The transfer now resolves as the pickup,
 * and the drop-off as "same as pickup", so the two agree.
 *
 * An explicit booking pickup still wins (and keeps its own distinct drop-off): that is a checkout guest
 * who typed a hotel, not a quote transfer.
 */
/** The airport end of an airport transfer is stored with the ARRIVAL qualifier — checkout hardcodes
 *  "SSR International Airport (arrivals)" for every direction. On a departure that same airport is the
 *  DROP-OFF, at departures, so relabel it. A no-op on any other string. */
function relabelAirportForDeparture(stored: string | null): string | null {
  return stored ? stored.replace(/\(\s*arrivals\s*\)/i, '(departures)') : stored;
}

export function resolvePickup(b: {
  pickupLocation: string | null;
  dropoffLocation: string | null;
  pickupPending: boolean;
  transportPickup?: string | null;
  transportDropoff?: string | null;
  /**
   * The airport-transfer trip direction, when this booking is one. An airport DEPARTURE is stored
   * arrival-oriented (pickup = the airport, drop-off = the hotel) because checkout hardcodes it — so
   * the day sheet read "Pickup: SSR Airport" for a guest who is AT their hotel waiting to go TO the
   * airport, and a driver briefed off it would go to the wrong place. Flip a departure to hotel →
   * airport(departures). An arrival is already correct; a return genuinely begins at the airport (and
   * is captioned "both ways" beside this). `trip_direction` is set ONLY for airport transfers, so this
   * never disturbs a hotel-to-hotel transfer or a plain activity pickup.
   */
  transferDirection?: string | null;
}): { pickup: PickupView; dropoff: DropoffView } {
  // Airport-transfer DEPARTURE remap: the two ends are the airport (stored as the pickup) and the
  // hotel (stored as the drop-off); a departure runs hotel → airport, so swap them and relabel the
  // airport parenthetical. Every other case reads its stored fields unchanged.
  const flip = b.transferDirection === 'departure';
  const pickupLocation = flip ? b.dropoffLocation : b.pickupLocation;
  const dropoffLocation = flip ? relabelAirportForDeparture(b.pickupLocation) : b.dropoffLocation;

  const roundTrip = !pickupLocation && !!b.transportPickup;
  const pickup: PickupView = pickupLocation
    ? { kind: 'text', text: pickupLocation, roundTrip: false }
    : b.transportPickup
      ? { kind: 'text', text: b.transportPickup, roundTrip: true }
      : b.pickupPending
        ? { kind: 'pending' }
        : { kind: 'none' };
  // A round trip's own distinct drop-off is rare, but honour it if set; otherwise a null drop-off WITH
  // a pickup means "same as pickup", and with no pickup at all it is a dash.
  const explicitDropoff = dropoffLocation ?? (roundTrip ? (b.transportDropoff ?? null) : null);
  const dropoff: DropoffView = explicitDropoff
    ? { kind: 'text', text: explicitDropoff }
    : pickup.kind === 'text' || pickup.kind === 'pending'
      ? { kind: 'same' }
      : { kind: 'dash' };
  return { pickup, dropoff };
}

/**
 * Where to collect the guest and where to leave them — plus the room for the driver's gate pass.
 *
 * `transportPickup`/`transportDropoff` fold a line's round-trip transfer into the reading (see
 * {@link resolvePickup}); `roomOrCabin` prints the hotel room independent of the airport-transfer block
 * (a plain activity pickup carries a room too). All three are optional, so the bookings drawer that
 * passes none renders exactly as before.
 */
export function PickupFacts({
  pickupLocation,
  dropoffLocation,
  pickupPending,
  transportPickup,
  transportDropoff,
  roomOrCabin,
  transferDirection,
}: {
  pickupLocation: string | null;
  dropoffLocation: string | null;
  pickupPending: boolean;
  transportPickup?: string | null;
  transportDropoff?: string | null;
  roomOrCabin?: string | null;
  /** Airport-transfer direction; flips a departure's pickup/drop-off. See {@link resolvePickup}. */
  transferDirection?: string | null;
}) {
  const { pickup, dropoff } = resolvePickup({
    pickupLocation,
    dropoffLocation,
    pickupPending,
    transportPickup: transportPickup ?? null,
    transportDropoff: transportDropoff ?? null,
    transferDirection: transferDirection ?? null,
  });
  return (
    <dl className="flex flex-col gap-2.5">
      <div>
        <dt className="text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">Pickup</dt>
        <dd className="mt-0.5 text-[13px] text-ink/80">
          {pickup.kind === 'text' ? (
            <>
              {pickup.text}
              {pickup.roundTrip && (
                <span className="mt-0.5 block text-[12px] font-medium text-teal-dark">
                  Round-trip transfer
                </span>
              )}
            </>
          ) : pickup.kind === 'pending' ? (
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
          {dropoff.kind === 'text' ? (
            dropoff.text
          ) : dropoff.kind === 'same' ? (
            <span className="text-ink-muted">Same as pickup</span>
          ) : (
            '—'
          )}
        </dd>
      </div>
      {roomOrCabin && (
        <div>
          <dt className="text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">
            Room / cabin
          </dt>
          <dd className="mt-0.5 text-[13px] text-ink/80">{roomOrCabin}</dd>
        </div>
      )}
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
