import type { BookingRow } from '@/lib/admin/bookings';
import type { DayBooking, DayCustomLine, DayDeparture, DayReturnLeg } from '@/lib/admin/calendar';

/* Small factories for the back office's day-sheet entries and booking rows, shared by the phase-2
 * tests (Today, the run sheet, the Bookings tabs). Same shapes as the calendar view tests' own. */

export const DAY = '2026-11-14';
/** Noon Mauritius on a day — where every day-slot sits. */
export const slot = (day: string) => `${day}T08:00:00Z`;

export function party(over: Partial<DayBooking> = {}): DayBooking {
  return {
    id: 'b1',
    ref: 'BMT-1',
    status: 'confirmed',
    paymentState: 'paid',
    counted: true,
    customerName: 'Marie Dupont',
    customerEmail: 'marie@example.com',
    customerPhone: '+33 6 12 34 56 78',
    source: 'web',
    bookedAt: '2026-11-09T10:04:00Z',
    totalEur: 372,
    pax: 4,
    lines: [
      { label: 'Adult', quantity: 2, pax: 2 },
      { label: 'Child', quantity: 2, pax: 2 },
    ],
    pickupLocation: 'Lux Belle Mare, Belle Mare',
    dropoffLocation: null,
    transportPickup: null,
    transportDropoff: null,
    pickupPending: false,
    roomOrCabin: '214',
    childSeats: 0,
    supplements: [],
    customItinerary: null,
    transfer: null,
    pickupTime: null,
    staffNote: null,
    awaitingChoice: false,
    notifiable: true,
    reschedulable: true,
    valueEur: 372,
    balanceDueEur: 0,
    payView: 'paid',
    ...over,
  };
}

export function departure(over: Partial<DayDeparture> = {}): DayDeparture {
  return {
    kind: 'occurrence',
    occurrenceId: 'occ1',
    activityOptionId: 'opt1',
    startsAt: slot(DAY),
    departureTime: '09:00',
    timeOverride: null,
    tourTime: '09:00',
    durationMinutes: 480,
    category: 'Catamaran cruises',
    isAirportTransfer: false,
    status: 'open',
    capacity: 12,
    guestsPerTrip: null,
    activityTitle: 'Catamaran cruise, 3 northern islands',
    optionName: 'Shared catamaran',
    pax: 4,
    units: 4,
    pendingPax: 0,
    valueEur: 372,
    bookings: [party()],
    ...over,
  };
}

export function quoteLine(over: Partial<DayCustomLine> = {}): DayCustomLine {
  return {
    kind: 'custom',
    id: 'ci1',
    lineKind: 'custom',
    description: 'Private south tour',
    startsAt: `${DAY}T04:30:00Z`,
    endsAt: null,
    rentalVehicleSlug: null,
    quantity: 1,
    guests: 2,
    pickupLabel: 'Constance Belle Mare Plage, Belle Mare',
    roomOrCabin: null,
    transportPickup: null,
    transportDropoff: null,
    counted: true,
    subtotalEur: 180,
    valueEur: 180,
    balanceDueEur: 0,
    payView: 'paid',
    bookingId: 'b9',
    ref: 'BMT-9',
    status: 'confirmed',
    paymentState: 'paid',
    customerName: 'James Carter',
    customerEmail: 'james@example.com',
    customerPhone: null,
    source: 'quote',
    bookedAt: '2026-11-01T10:00:00Z',
    staffNote: null,
    ...over,
  };
}

export function returnLeg(over: Partial<DayReturnLeg> = {}): DayReturnLeg {
  return {
    kind: 'return-leg',
    bookingId: 'b7',
    ref: 'BMT-7',
    startsAt: `${DAY}T18:30:00+04:00`,
    status: 'confirmed',
    paymentState: 'paid',
    counted: true,
    customerName: 'Oliver Bennett',
    customerEmail: 'o@x.uk',
    customerPhone: '+44 7700 900123',
    source: 'web',
    bookedAt: '2026-10-01T10:00:00Z',
    pax: 3,
    vehicleLabel: 'Sedan',
    pickup: 'Ambre Resort & Spa, Belle Mare',
    dropoff: 'SSR International Airport (arrivals)',
    departureTime: '18:30',
    flightNumber: 'MK 014',
    roomOrCabin: null,
    staffNote: null,
    balanceDueEur: 0,
    payView: 'paid',
    ...over,
  };
}

export function bookingRow(over: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 'id',
    ref: 'BMT-0001',
    status: 'confirmed',
    paymentState: 'paid',
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@x.com',
    customerPhone: null,
    source: 'web',
    currency: 'EUR',
    totalEur: 100,
    notes: null,
    createdAt: '2026-11-10T06:00:00Z',
    items: [],
    activityTitle: 'Catamaran Cruise',
    startsAt: null,
    guests: 2,
    netPaidEur: 100,
    grossPaidEur: 100,
    refundedEur: 0,
    customItinerary: null,
    pickupLocation: null,
    dropoffLocation: null,
    pickupPending: false,
    transportPickup: null,
    transportDropoff: null,
    childSeats: 0,
    transportEur: 0,
    supplements: [],
    customItems: [],
    balanceDueEur: 0,
    depositEur: 0,
    installments: [],
    transfer: null,
    pickupTime: null,
    departureTime: null,
    ...over,
  };
}
