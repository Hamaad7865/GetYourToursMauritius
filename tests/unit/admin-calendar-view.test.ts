import { describe, expect, it } from 'vitest';
import {
  ALL_TYPES_ON,
  customLineType,
  deltaPct,
  departureType,
  linesByDay,
  mauritiusMinutes,
  monthCells,
  monthGridRange,
  movePickerDays,
  summarize,
  timelineBars,
  timePresets,
  timeWarning,
  toCalLine,
  toCalLines,
  type CalFilters,
} from '@/lib/admin/calendar-view';
import type { DayBooking, DayCustomLine, DayDeparture, DayReturnLeg } from '@/lib/admin/calendar';

/* The redesigned operations calendar draws everything from these pure rules: what type a line is,
 * what still needs doing, what the period adds up to, and where a departure may be moved. */

const TODAY = '2026-10-26';
/** Noon Mauritius on a day — where every day-slot sits. */
const slot = (day: string) => `${day}T08:00:00Z`;

function party(over: Partial<DayBooking> = {}): DayBooking {
  return {
    id: 'b1',
    ref: 'BMT-1',
    status: 'confirmed',
    paymentState: 'paid',
    counted: true,
    customerName: 'Camille Lefèvre',
    customerEmail: 'c@x.fr',
    customerPhone: '+33 6 12 34 56 78',
    source: 'web',
    bookedAt: '2026-10-01T10:00:00Z',
    totalEur: 190,
    pax: 2,
    lines: [{ label: 'Adult', quantity: 2, pax: 2 }],
    pickupLocation: 'LUX* Belle Mare, Belle Mare',
    dropoffLocation: null,
    transportPickup: null,
    transportDropoff: null,
    pickupPending: false,
    roomOrCabin: null,
    childSeats: 0,
    supplements: [],
    customItinerary: null,
    transfer: null,
    pickupTime: null,
    staffNote: null,
    awaitingChoice: false,
    notifiable: true,
    reschedulable: true,
    valueEur: 190,
    balanceDueEur: 0,
    ...over,
  };
}

function departure(over: Partial<DayDeparture> = {}): DayDeparture {
  return {
    kind: 'occurrence',
    occurrenceId: 'occ1',
    activityOptionId: 'opt1',
    startsAt: slot(TODAY),
    departureTime: '09:00',
    timeOverride: null,
    tourTime: '09:00',
    durationMinutes: 480,
    category: 'Taxi Sightseeing tours',
    isAirportTransfer: false,
    status: 'open',
    capacity: 10,
    guestsPerTrip: null,
    activityTitle: 'Private South Tour',
    optionName: 'Private Group',
    pax: 2,
    units: 1,
    pendingPax: 0,
    valueEur: 190,
    bookings: [party()],
    ...over,
  };
}

function quoteLine(over: Partial<DayCustomLine> = {}): DayCustomLine {
  return {
    kind: 'custom',
    id: 'ci1',
    lineKind: 'custom',
    description: 'Bois Chéri and highlands viewpoints',
    startsAt: `${TODAY}T05:00:00Z`,
    endsAt: null,
    rentalVehicleSlug: null,
    quantity: 1,
    guests: 2,
    pickupLabel: 'InterContinental Resort Mauritius, Balaclava',
    roomOrCabin: null,
    transportPickup: null,
    transportDropoff: null,
    counted: true,
    subtotalEur: 140,
    valueEur: 140,
    balanceDueEur: 0,
    bookingId: 'b9',
    ref: 'BMT-9',
    status: 'confirmed',
    paymentState: 'paid',
    customerName: 'Jean Claude',
    customerEmail: 'jc@x.fr',
    customerPhone: null,
    source: 'quote',
    bookedAt: '2026-09-10T14:44:00Z',
    staffNote: null,
    ...over,
  };
}

function returnLeg(over: Partial<DayReturnLeg> = {}): DayReturnLeg {
  return {
    kind: 'return-leg',
    bookingId: 'b7',
    ref: 'BMT-7',
    startsAt: `${TODAY}T18:30:00+04:00`,
    status: 'confirmed',
    paymentState: 'paid',
    counted: true,
    customerName: 'Oliver Bennett',
    customerEmail: 'o@x.uk',
    customerPhone: null,
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
    ...over,
  };
}

const ON: CalFilters = { types: ALL_TYPES_ON, attentionOnly: false };

describe('line types', () => {
  it('sorts catalogue departures by product and category', () => {
    expect(departureType(departure())).toBe('tour');
    expect(departureType(departure({ category: 'Catamaran cruises' }))).toBe('sea');
    expect(departureType(departure({ category: 'Speedboat Tours' }))).toBe('sea');
    expect(departureType(departure({ category: 'Airport transfers' }))).toBe('transfer');
    expect(departureType(departure({ isAirportTransfer: true }))).toBe('transfer');
    // A hotel-to-hotel transfer is known by its party's pickup time.
    expect(departureType(departure({ bookings: [party({ pickupTime: '07:15' })] }))).toBe(
      'transfer',
    );
  });

  it('reads a quote line by its kind, then (heuristically) its words', () => {
    expect(customLineType({ lineKind: 'rental', description: 'Nissan March · 3 days' })).toBe(
      'rental',
    );
    expect(customLineType({ lineKind: 'custom', description: 'Tourist levy' })).toBe('extra');
    expect(customLineType({ lineKind: 'custom', description: 'Entrance fee of chamarel' })).toBe(
      'extra',
    );
    expect(
      customLineType({ lineKind: 'custom', description: 'Journée privée nage avec les dauphins' }),
    ).toBe('sea');
    expect(
      customLineType({ lineKind: 'custom', description: 'Round-trip transfer · from LUX*' }),
    ).toBe('transfer');
    expect(customLineType({ lineKind: 'custom', description: 'Circuit privé dans le Nord' })).toBe(
      'tour',
    );
  });
});

describe('a calendar line', () => {
  it('carries the departure’s own time, guests, value and where it starts', () => {
    const l = toCalLine(departure({ departureTime: '08:15', timeOverride: '08:15' }), TODAY);
    expect(l).toMatchObject({
      key: 'occ-occ1',
      day: TODAY,
      type: 'tour',
      time: '08:15',
      guests: 2,
      valueEur: 190,
      where: 'LUX* Belle Mare',
      flags: [],
      allDay: false,
    });
  });

  it('flags what still needs doing on an upcoming departure', () => {
    const l = toCalLine(
      departure({
        bookings: [
          party({ id: 'a', counted: false, status: 'payment_pending', paymentState: 'pending' }),
          party({ id: 'b', pickupLocation: null, pickupPending: true }),
          party({ id: 'c' }),
        ],
      }),
      TODAY,
    );
    expect(l.flags).toEqual(['Unpaid', 'Pickup missing']);
    expect(l.flaggedParties).toBe(2);
    expect(l.partyFlags).toEqual({ a: ['Unpaid'], b: ['Pickup missing'], c: [] });
  });

  it('flags nothing on the past or on a called-off departure', () => {
    const unpaid = [party({ counted: false, status: 'payment_pending' })];
    expect(toCalLine(departure({ bookings: unpaid }), '2026-10-27').flags).toEqual([]);
    expect(toCalLine(departure({ bookings: unpaid, status: 'cancelled' }), TODAY).flags).toEqual(
      [],
    );
  });

  it('asks for the flight an airport transfer meets', () => {
    const transfer = {
      direction: 'arrival',
      roomOrCabin: null,
      flightNumber: null,
      arrivalTime: '15:50',
      returnDate: null,
      returnTime: null,
      departureFlightNumber: null,
      luggageDetails: null,
      childSeatAge: null,
      travellerCountry: null,
      travellerCompany: null,
      travellerGender: null,
      specialNotes: null,
    };
    const l = toCalLine(
      departure({ isAirportTransfer: true, bookings: [party({ transfer })] }),
      TODAY,
    );
    expect(l.type).toBe('transfer');
    expect(l.flags).toEqual(['Flight missing']);
    expect(l.whereMissing).toBe(true);
  });

  it('puts a rental or a fee under "All day", and a quote tour at its own time', () => {
    expect(
      toCalLine(quoteLine({ lineKind: 'rental', description: 'Nissan March' }), TODAY),
    ).toMatchObject({
      type: 'rental',
      allDay: true,
      time: null,
      guests: 0,
    });
    expect(toCalLine(quoteLine(), TODAY)).toMatchObject({
      type: 'tour',
      time: '09:00',
      guests: 2,
      fromQuote: true,
      where: 'InterContinental Resort Mauritius',
    });
  });

  it('shows a return transfer’s departure leg from the hotel, counting no money twice', () => {
    expect(toCalLine(returnLeg(), TODAY)).toMatchObject({
      type: 'transfer',
      time: '18:30',
      guests: 3,
      valueEur: 0,
      where: 'Ambre Resort & Spa → airport',
      flags: [],
    });
    expect(toCalLine(returnLeg({ flightNumber: null }), TODAY).flags).toEqual(['Flight missing']);
  });

  it('orders a day by time, untimed last', () => {
    const lines = toCalLines(
      [
        departure({ occurrenceId: 'x', departureTime: null }),
        departure({ occurrenceId: 'y', departureTime: '16:00' }),
        returnLeg(),
        quoteLine(),
      ],
      TODAY,
    );
    expect(lines.map((l) => l.time)).toEqual(['09:00', '16:00', '18:30', null]);
  });
});

describe('the period’s figures', () => {
  const lines = toCalLines(
    [
      departure({ occurrenceId: 'a', pax: 4, valueEur: 300 }),
      departure({ occurrenceId: 'b', startsAt: slot('2026-10-27'), pax: 6, valueEur: 200 }),
      departure({ occurrenceId: 'c', status: 'cancelled', pax: 3, valueEur: 90 }),
      quoteLine({ lineKind: 'rental', description: 'Nissan March', valueEur: 105 }),
      // Only an unpaid party: a departure with nobody counted yet.
      departure({
        occurrenceId: 'd',
        pax: 0,
        pendingPax: 2,
        valueEur: 0,
        bookings: [party({ counted: false, status: 'payment_pending' })],
      }),
    ],
    TODAY,
  );

  it('counts live departures, guests, value and what needs attention', () => {
    const s = summarize(lines, '2026-10-01', '2026-10-31', ON);
    expect(s.departures).toBe(3);
    expect(s.calledOff).toBe(1);
    expect(s.guests).toBe(10);
    expect(s.peak).toEqual({ day: '2026-10-27', guests: 6 });
    expect(s.valueEur).toBe(300 + 200 + 105);
    expect(s.attention).toBe(1);
    expect(s.typeCounts).toEqual({ tour: 3, sea: 0, transfer: 0, rental: 1, extra: 0 });
  });

  it('leaves out a type switched off', () => {
    const s = summarize(lines, '2026-10-01', '2026-10-31', {
      types: { ...ALL_TYPES_ON, rental: false },
      attentionOnly: false,
    });
    expect(s.valueEur).toBe(300 + 200);
  });

  it('gives no % change against a period that earned nothing', () => {
    expect(deltaPct(120, 100)).toBe(20);
    expect(deltaPct(80, 100)).toBe(-20);
    expect(deltaPct(80, 0)).toBeNull();
  });
});

describe('the month grid', () => {
  it('runs Monday to Sunday around the month', () => {
    expect(monthGridRange(2026, 9)).toEqual({
      first: '2026-10-01',
      last: '2026-10-31',
      from: '2026-09-28',
      to: '2026-11-01',
    });
  });

  it('fills each day, marks today and the past, and loads against the busiest day', () => {
    const byDay = linesByDay(
      toCalLines(
        [
          departure({ occurrenceId: 'a', pax: 4 }),
          departure({ occurrenceId: 'b', startsAt: slot('2026-10-27'), pax: 8 }),
        ],
        TODAY,
      ),
    );
    const cells = monthCells(2026, 9, byDay, TODAY, ON);
    expect(cells).toHaveLength(35);
    const today = cells.find((c) => c.day === TODAY)!;
    expect(today).toMatchObject({ isToday: true, isPast: false, guests: 4, load: 0.5 });
    expect(cells.find((c) => c.day === '2026-10-27')!.load).toBe(1);
    expect(cells.find((c) => c.day === '2026-10-25')!.isPast).toBe(true);
    expect(cells[0]).toMatchObject({ day: '2026-09-28', inMonth: false });
  });

  it('shows only what needs attention when asked', () => {
    const byDay = linesByDay(
      toCalLines(
        [
          departure({ occurrenceId: 'a' }),
          departure({
            occurrenceId: 'b',
            bookings: [party({ counted: false, status: 'payment_pending' })],
          }),
        ],
        TODAY,
      ),
    );
    const cell = monthCells(2026, 9, byDay, TODAY, { ...ON, attentionOnly: true }).find(
      (c) => c.day === TODAY,
    )!;
    expect(cell.items.map((l) => l.key)).toEqual(['occ-b']);
    expect(cell.hasAttention).toBe(true);
  });
});

describe('the day timeline', () => {
  it('stacks overlapping departures into lanes and skips the untimed and called off', () => {
    const { bars, lanes } = timelineBars(
      toCalLines(
        [
          departure({ occurrenceId: 'a', departureTime: '08:00', durationMinutes: 240 }),
          departure({ occurrenceId: 'b', departureTime: '09:00', durationMinutes: 60 }),
          departure({ occurrenceId: 'c', departureTime: '13:00', durationMinutes: 60 }),
          departure({ occurrenceId: 'd', departureTime: null }),
          departure({ occurrenceId: 'e', departureTime: '10:00', status: 'cancelled' }),
        ],
        TODAY,
      ),
    );
    expect(bars.map((b) => [b.key, b.lane])).toEqual([
      ['occ-a', 0],
      ['occ-b', 1],
      ['occ-c', 0],
    ]);
    expect(lanes).toBe(2);
    expect(bars[0]!.left).toBeCloseTo(2 / 14);
    expect(bars[0]!.width).toBeCloseTo(4 / 14);
  });

  it('reads the clock in Mauritius time, wherever staff are', () => {
    expect(mauritiusMinutes(new Date('2026-10-26T05:30:00Z'))).toBe(9 * 60 + 30);
    expect(mauritiusMinutes(new Date('2026-10-26T21:15:00Z'))).toBe(75);
  });
});

describe('moving a departure', () => {
  const targets = [
    { occurrenceId: 't1', startsAt: slot('2026-10-28'), seatsLeft: 6 },
    { occurrenceId: 't2', startsAt: slot('2026-10-29'), seatsLeft: 1 },
  ];

  it('offers three weeks from the departure’s Monday, only where the tour runs with room', () => {
    const days = movePickerDays(TODAY, TODAY, targets, 2);
    expect(days).toHaveLength(21);
    expect(days[0]!.day).toBe('2026-10-26');
    expect(days.find((d) => d.day === TODAY)).toMatchObject({ current: true, disabled: true });
    expect(days.find((d) => d.day === '2026-10-28')).toMatchObject({
      disabled: false,
      seatsLeft: 6,
    });
    expect(days.find((d) => d.day === '2026-10-28')!.target?.occurrenceId).toBe('t1');
    expect(days.find((d) => d.day === '2026-10-29')).toMatchObject({
      disabled: true,
      reason: 'Only 1 left',
    });
    expect(days.find((d) => d.day === '2026-10-30')).toMatchObject({
      disabled: true,
      reason: 'This tour does not run that day',
    });
  });

  it('says a day is full rather than that the tour does not run', () => {
    const full = [{ occurrenceId: 't3', startsAt: slot('2026-10-30'), seatsLeft: 0 }];
    expect(movePickerDays(TODAY, TODAY, full, 2).find((d) => d.day === '2026-10-30')).toMatchObject(
      { disabled: true, reason: 'Full' },
    );
  });

  it('starts from this week for a departure already in the past', () => {
    expect(movePickerDays('2026-10-01', TODAY, [], 1)[0]!.day).toBe('2026-10-26');
  });
});

describe('changing a departure’s time', () => {
  it('suggests half-hour steps around the usual time', () => {
    expect(timePresets(9 * 60)).toEqual([450, 480, 510, 540, 570, 600, 630]);
  });

  it('warns about a probably-mistaken time', () => {
    expect(timeWarning(5 * 60 + 30, 240)).toBe('Starts before 06:00.');
    expect(timeWarning(16 * 60, 360)).toBe('Finishes after 21:00.');
    expect(timeWarning(9 * 60, 480)).toBeNull();
  });
});
