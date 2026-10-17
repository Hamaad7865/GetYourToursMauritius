/**
 * A transfer's DIRECTION decides which leg's date is the booking's day-slot.
 *
 * Every booking hangs off ONE `session_occurrences` row — a day-slot — and that row is chosen by the
 * booking widget (availability → hold) before checkout. The booking stores no separate arrival date:
 * the inbound leg's date IS the occurrence's day, and a departure-only trip's pickup date rides in
 * `returnDate` (see `transferLegs()` in leg-times.ts). So the occurrence must sit on the day of the
 * FIRST leg the guest actually travels — the "anchor":
 *
 * - arrival / return → the airport pickup (the arrival date)
 * - departure        → the hotel pickup (the departure date)
 *
 * Before this module the widget only knew "one-way = arrival", and checkout let the guest switch to
 * Departure and type a different day, which moved nothing: both prod departure-only bookings held a
 * slot on the widget's day (2026-10-09) while the guest left on 2026-10-15. Now the widget picks the
 * direction, reserves the anchor's day, and checkout shows that day read-only and only offers
 * directions that share it. Pure — the widget, the hotel-to-hotel console and checkout all call it.
 */

export type TransferDirection = 'arrival' | 'departure' | 'return';

const DIRECTIONS: readonly TransferDirection[] = ['arrival', 'departure', 'return'];

/**
 * The direction a checkout URL (or cart line) carries. A valid `tripDirection` wins; anything else
 * falls back to the legacy `tripType` the widget sent before directions existed — return stays
 * return, a one-way was always an arrival.
 */
export function parseTransferDirection(
  tripDirection: string | null | undefined,
  tripType: string | null | undefined,
): TransferDirection {
  if (DIRECTIONS.includes(tripDirection as TransferDirection)) {
    return tripDirection as TransferDirection;
  }
  return tripType === 'return' ? 'return' : 'arrival';
}

/** The priced trip type: only a return is two legs; arrival and departure are each one. */
export function tripTypeForDirection(direction: TransferDirection): 'one_way' | 'return' {
  return direction === 'return' ? 'return' : 'one_way';
}

/** The leg whose date is the booking's day-slot. */
export function anchorLeg(direction: TransferDirection): 'arrival' | 'departure' {
  return direction === 'departure' ? 'departure' : 'arrival';
}

/**
 * The directions checkout may offer without moving the booking off its reserved day — the ones that
 * share the anchor. Arrival ↔ return is a price change the reconciliation gate already catches;
 * switching to or from departure would put the guest's travel day on a different leg than the slot.
 */
export function directionsSharingAnchor(direction: TransferDirection): TransferDirection[] {
  return anchorLeg(direction) === 'departure' ? ['departure'] : ['arrival', 'return'];
}

/**
 * The checkout-draft direction to restore: the saved one only when it shares the URL's anchor, else
 * the URL's own. A draft written before this fix could hold "departure" on an arrival-reserved slot.
 */
export function restoreDirection(
  saved: TransferDirection | undefined,
  fromUrl: TransferDirection,
): TransferDirection {
  return saved && anchorLeg(saved) === anchorLeg(fromUrl) ? saved : fromUrl;
}

/**
 * The day the widget reserved, read back from the checkout URL: a departure-anchored trip carries it
 * as `retDate`, everything else as `arrDate`. '' when the URL lacks it (hand-edited or truncated).
 */
export function reservedDay(input: {
  direction: TransferDirection;
  arrDate: string | null | undefined;
  retDate: string | null | undefined;
}): string {
  const day = anchorLeg(input.direction) === 'departure' ? input.retDate : input.arrDate;
  return (day ?? '').slice(0, 40);
}

/**
 * The legs' dates as checkout shows and sends them. The anchor leg is ALWAYS the reserved day — it is
 * not editable at checkout, because changing it there could not move the occurrence. Only a return
 * trip's second leg (`returnLegDate`) is the guest's to edit: it consumes no slot of its own.
 */
export function legDates(input: {
  direction: TransferDirection;
  reservedDay: string;
  returnLegDate: string;
}): { arrivalDate: string; departureDate: string } {
  switch (input.direction) {
    case 'departure':
      return { arrivalDate: '', departureDate: input.reservedDay };
    case 'return':
      return { arrivalDate: input.reservedDay, departureDate: input.returnLegDate };
    default:
      return { arrivalDate: input.reservedDay, departureDate: '' };
  }
}

/**
 * The widget → checkout leg params. `date`/`time` are the FIRST leg — the airport pickup for an
 * arrival or return, the hotel pickup for a departure — and `date` is the day the widget reserved.
 * A departure's pickup rides as retDate/retTime, where checkout and the booking already keep it.
 */
export function transferLegParams(input: {
  direction: TransferDirection;
  date: string;
  time: string;
  returnDate: string;
  returnTime: string;
}): Record<string, string> {
  const q: Record<string, string> = {
    tripDirection: input.direction,
    tripType: tripTypeForDirection(input.direction),
  };
  if (input.direction === 'departure') {
    if (input.date) q.retDate = input.date;
    if (input.time) q.retTime = input.time;
    return q;
  }
  if (input.date) q.arrDate = input.date;
  if (input.time) q.arr = input.time;
  if (input.direction === 'return') {
    if (input.returnDate) q.retDate = input.returnDate;
    if (input.returnTime) q.retTime = input.returnTime;
  }
  return q;
}
