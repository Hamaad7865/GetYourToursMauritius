import { describe, expect, it } from 'vitest';
import {
  customLineDays,
  mapDayCustomLines,
  mapDaySchedule,
  notifiableCount,
  type RawDayCustomItem,
  type RawDayRow,
} from '@/lib/admin/calendar';

/* The calendar's day sheet is what staff read before driving out to collect people, so the rules it
 * encodes are operational, not cosmetic: who is actually coming, how many seats they hold, which
 * bands were sold, and — before a call-off — exactly who the database will email. */

type RawItem = NonNullable<RawDayRow['booking_items']>[number];
type RawBooking = NonNullable<Exclude<RawItem['bookings'], unknown[]>>;
type Status = RawBooking['status'];

const NO_TRANSFER = {
  trip_direction: null,
  room_or_cabin: null,
  flight_number: null,
  arrival_time: null,
  return_date: null,
  return_time: null,
  departure_flight_number: null,
  luggage_details: null,
  child_seat_age: null,
  traveller_country: null,
  traveller_company: null,
  traveller_gender: null,
  special_notes: null,
};

function booking(over: Partial<RawBooking> = {}): RawBooking {
  return {
    id: 'b1',
    ref: 'BMT001',
    status: 'confirmed',
    payment_state: 'paid',
    customer_name: 'Ada Lovelace',
    customer_email: 'ada@example.com',
    customer_phone: '+230 5555 0000',
    source: 'web',
    total_minor: 12000,
    notes: null,
    created_at: '2026-08-01T09:00:00Z',
    custom_itinerary: null,
    pickup_location: null,
    dropoff_location: null,
    pickup_pending: false,
    child_seats: 0,
    booking_supplements: [],
    disruption: null,
    ...NO_TRANSFER,
    ...over,
  };
}

function item(over: Partial<RawItem> = {}): RawItem {
  return { quantity: 2, pax: null, price_label: 'Adult', bookings: booking(), ...over };
}

function row(items: RawItem[], over: Partial<RawDayRow> = {}): RawDayRow {
  return {
    id: 'occ1',
    activity_option_id: 'opt1',
    starts_at: '2026-08-18T05:00:00Z',
    status: 'open',
    capacity: 12,
    activity_options: { name: 'Shared tour', activities: { title: 'Ile aux Cerfs' } },
    booking_items: items,
    ...over,
  };
}

/** A booking_custom_items row embedding its owning booking — the shape loadDaySchedule's second
 *  query returns. The embedded booking reuses the same `booking()` factory the occurrence rows use. */
function customItem(over: Partial<RawDayCustomItem> = {}): RawDayCustomItem {
  return {
    id: 'ci1',
    kind: 'custom',
    description: 'Private south tour',
    starts_at: '2026-08-18T05:00:00Z',
    ends_at: null,
    rental_vehicle_slug: null,
    quantity: 1,
    unit_amount_minor: 20000,
    subtotal_minor: 20000,
    bookings: booking(),
    ...over,
  };
}

describe('mapDaySchedule', () => {
  it('drops a departure nobody is on', () => {
    expect(mapDaySchedule([row([])])).toEqual([]);
  });

  it('reads the activity and option through the embedded relations', () => {
    const [dep] = mapDaySchedule([row([item()])]);
    expect(dep?.activityTitle).toBe('Ile aux Cerfs');
    expect(dep?.optionName).toBe('Shared tour');
  });

  // One party, several price bands — the guide needs "2 adults and a child", not "3 pax".
  it('merges a booking’s lines into one party but keeps the bands apart', () => {
    const [dep] = mapDaySchedule([
      row([
        item({ quantity: 2, price_label: 'Adult' }),
        item({ quantity: 1, price_label: 'Child' }),
      ]),
    ]);
    expect(dep?.bookings).toHaveLength(1);
    expect(dep?.bookings[0]?.pax).toBe(3);
    expect(dep?.bookings[0]?.lines).toEqual([
      { label: 'Adult', quantity: 2, pax: 2 },
      { label: 'Child', quantity: 1, pax: 1 },
    ]);
  });

  it('folds two lines of the same band together', () => {
    const [dep] = mapDaySchedule([
      row([
        item({ quantity: 2, price_label: 'Adult' }),
        item({ quantity: 1, price_label: 'Adult' }),
      ]),
    ]);
    expect(dep?.bookings[0]?.lines).toEqual([{ label: 'Adult', quantity: 3, pax: 3 }]);
  });

  it('keeps two different bookings as two parties', () => {
    const [dep] = mapDaySchedule([
      row([item(), item({ bookings: booking({ id: 'b2', ref: 'BMT002' }) })]),
    ]);
    expect(dep?.bookings.map((b) => b.ref)).toEqual(['BMT001', 'BMT002']);
  });

  // A vehicle line's `quantity` is the number of VANS; summing it would report a 6-guest transfer
  // as 1 person.
  it('counts people with pax, not the vehicle quantity', () => {
    const [dep] = mapDaySchedule([
      row([item({ quantity: 1, pax: 6, price_label: 'Private van' })]),
    ]);
    expect(dep?.pax).toBe(6);
    expect(dep?.bookings[0]?.lines).toEqual([{ label: 'Private van', quantity: 1, pax: 6 }]);
  });

  it('falls back to the option name when a line has no price label', () => {
    const [dep] = mapDaySchedule([row([item({ price_label: null })])]);
    expect(dep?.bookings[0]?.lines[0]?.label).toBe('Shared tour');
  });

  describe('which bookings appear', () => {
    it.each<Status>(['confirmed', 'completed'])(
      'counts a %s booking in the headcount',
      (status) => {
        const [dep] = mapDaySchedule([row([item({ bookings: booking({ status }) })])]);
        expect(dep?.pax).toBe(2);
        expect(dep?.pendingPax).toBe(0);
        expect(dep?.bookings[0]?.counted).toBe(true);
      },
    );

    // Live-but-unpaid: worth seeing, but they hold no seat — folding them into `pax` would make this
    // card disagree with the month grid and with used_capacity.
    it.each<Status>(['held', 'payment_pending'])(
      'shows a %s booking without counting it',
      (status) => {
        const [dep] = mapDaySchedule([row([item({ bookings: booking({ status }) })])]);
        expect(dep?.pax).toBe(0);
        expect(dep?.pendingPax).toBe(2);
        expect(dep?.bookings[0]?.counted).toBe(false);
      },
    );

    it.each<Status>(['draft', 'expired', 'cancelled', 'refund_pending', 'refunded', 'failed'])(
      'hides a %s booking entirely',
      (status) => {
        expect(mapDaySchedule([row([item({ bookings: booking({ status }) })])])).toEqual([]);
      },
    );

    it('lists paying guests before the unpaid tail', () => {
      const [dep] = mapDaySchedule([
        row([
          item({ bookings: booking({ id: 'b1', ref: 'PENDING', status: 'payment_pending' }) }),
          item({ bookings: booking({ id: 'b2', ref: 'PAID' }) }),
        ]),
      ]);
      expect(dep?.bookings.map((b) => b.ref)).toEqual(['PAID', 'PENDING']);
    });
  });

  it('carries the operational detail staff would otherwise leave the screen for', () => {
    const [dep] = mapDaySchedule([
      row([
        item({
          bookings: booking({
            child_seats: 2,
            pickup_location: 'Hotel Ambre, Belle Mare',
            dropoff_location: null,
            pickup_pending: false,
            notes: 'Repeat guest',
            custom_itinerary: [{ title: 'Trou aux Cerfs', area: 'Curepipe' }],
            total_minor: 45050,
          }),
        }),
      ]),
    ]);
    const b = dep?.bookings[0];
    expect(b?.childSeats).toBe(2);
    expect(b?.pickupLocation).toBe('Hotel Ambre, Belle Mare');
    expect(b?.staffNote).toBe('Repeat guest');
    expect(b?.customItinerary).toEqual([{ title: 'Trou aux Cerfs', area: 'Curepipe' }]);
    expect(b?.totalEur).toBe(450.5);
    expect(b?.customerEmail).toBe('ada@example.com');
  });

  // api_reschedule_booking refuses anything that isn't confirmed+paid, so a Move button on one of
  // these could only ever produce `not_reschedulable`.
  describe('reschedulable', () => {
    it('is true for a confirmed, paid booking', () => {
      const [dep] = mapDaySchedule([row([item()])]);
      expect(dep?.bookings[0]?.reschedulable).toBe(true);
    });

    it('is false for a completed booking, which counts but owns no movable seat', () => {
      const [dep] = mapDaySchedule([row([item({ bookings: booking({ status: 'completed' }) })])]);
      expect(dep?.bookings[0]?.counted).toBe(true);
      expect(dep?.bookings[0]?.reschedulable).toBe(false);
    });

    it('is false for an unpaid booking', () => {
      const [dep] = mapDaySchedule([
        row([item({ bookings: booking({ status: 'payment_pending', payment_state: 'pending' }) })]),
      ]);
      expect(dep?.bookings[0]?.reschedulable).toBe(false);
    });
  });

  it('builds a transfer block only for an actual transfer', () => {
    const [plain] = mapDaySchedule([row([item()])]);
    expect(plain?.bookings[0]?.transfer).toBeNull();

    const [transfer] = mapDaySchedule([
      row([
        item({
          bookings: booking({
            trip_direction: 'arrival',
            flight_number: 'MK015',
            child_seat_age: 3,
          }),
        }),
      ]),
    ]);
    expect(transfer?.bookings[0]?.transfer).toMatchObject({
      direction: 'arrival',
      flightNumber: 'MK015',
      childSeatAge: 3,
    });
  });

  // The TS twin of booking_awaiting_choice(jsonb): non-null disruption with no resolvedAt means the
  // guest was called off and still owes us a choice.
  it('flags a guest who still owes us a new date or a refund', () => {
    const unresolved = mapDaySchedule([
      row([item({ bookings: booking({ disruption: { resolvedAt: null } }) })]),
    ]);
    expect(unresolved[0]?.bookings[0]?.awaitingChoice).toBe(true);

    const resolved = mapDaySchedule([
      row([item({ bookings: booking({ disruption: { resolvedAt: '2026-08-02T10:00:00Z' } }) })]),
    ]);
    expect(resolved[0]?.bookings[0]?.awaitingChoice).toBe(false);
  });
});

/* api_weather_cancel_occurrence fans out to `confirmed AND paid AND not booking_awaiting_choice`.
 * The confirmation dialog quotes this number, so a mismatch tells staff that guests were emailed
 * when they were not. */
describe('notifiableCount', () => {
  function countFor(over: Partial<RawBooking>): number {
    const [dep] = mapDaySchedule([row([item({ bookings: booking(over) })])]);
    return dep ? notifiableCount(dep) : 0;
  }

  it('counts a confirmed, paid guest', () => {
    expect(countFor({})).toBe(1);
  });

  it('skips a completed booking — the RPC only fans out to confirmed ones', () => {
    expect(countFor({ status: 'completed' })).toBe(0);
  });

  it('skips an unpaid booking', () => {
    expect(countFor({ status: 'payment_pending', payment_state: 'pending' })).toBe(0);
  });

  it('skips a guest already mid-choice from an earlier call-off', () => {
    expect(countFor({ disruption: { resolvedAt: null } })).toBe(0);
  });

  it('counts a guest whose previous disruption was resolved', () => {
    expect(countFor({ disruption: { resolvedAt: '2026-08-02T10:00:00Z' } })).toBe(1);
  });

  it('counts each party once however many lines it has', () => {
    const [dep] = mapDaySchedule([
      row([item({ price_label: 'Adult' }), item({ price_label: 'Child', quantity: 1 })]),
    ]);
    expect(notifiableCount(dep!)).toBe(1);
  });
});

/* A converted-quote booking can be made entirely of booking_custom_items (bespoke lines and car
 * rentals) with zero booking_items — so it lives on no session_occurrence and, before Phase C,
 * appeared on the day sheet nowhere. mapDayCustomLines folds those dated lines onto their day as a
 * separate `kind: 'custom'` entry: no occurrence, no capacity and no seat count — a rental's
 * `quantity` is VEHICLES, never people, and a line with no date belongs to no day. */
describe('mapDayCustomLines', () => {
  it('surfaces a dated custom line as a custom-kind entry with its owning guest', () => {
    const [line] = mapDayCustomLines([customItem()]);
    expect(line?.kind).toBe('custom');
    expect(line?.lineKind).toBe('custom');
    expect(line?.description).toBe('Private south tour');
    expect(line?.startsAt).toBe('2026-08-18T05:00:00Z');
    expect(line?.ref).toBe('BMT001');
    expect(line?.customerName).toBe('Ada Lovelace');
    expect(line?.customerEmail).toBe('ada@example.com');
    expect(line?.subtotalEur).toBe(200);
  });

  it('surfaces a rental line, carries its return day, and folds no vehicle count into pax', () => {
    const lines = mapDayCustomLines([
      customItem({
        kind: 'rental',
        description: 'Nissan Kicks — 3 days',
        rental_vehicle_slug: 'nissan-kicks',
        quantity: 3, // 3 VEHICLES — must never read as 3 guests
        ends_at: '2026-08-21T05:00:00Z',
        subtotal_minor: 90000,
      }),
    ]);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.lineKind).toBe('rental');
    expect(line.rentalVehicleSlug).toBe('nissan-kicks');
    expect(line.endsAt).toBe('2026-08-21T05:00:00Z');
    expect(line.quantity).toBe(3);
    // A custom entry carries no headcount at all: quantity stays a vehicle count, never a `pax`.
    expect('pax' in line).toBe(false);
  });

  it('shows a line with no start date on no day', () => {
    expect(mapDayCustomLines([customItem({ starts_at: null })])).toEqual([]);
  });

  it('hides a line whose owning booking is not live', () => {
    for (const status of ['draft', 'expired', 'cancelled', 'refunded', 'failed'] as const) {
      expect(mapDayCustomLines([customItem({ bookings: booking({ status }) })])).toEqual([]);
    }
  });

  // The call-off UI acts on a departure's occurrence and its bookings. A custom/rental line has
  // neither, so it must never reach notifiableCount or offer a call-off control.
  it('keeps custom and rental lines out of the call-off count', () => {
    const [dep] = mapDaySchedule([row([item()])]);
    const [line] = mapDayCustomLines([customItem({ kind: 'rental', quantity: 4 })]);
    expect(notifiableCount(dep!)).toBe(1); // the one occurrence party, unaffected by the rental
    expect(line?.kind).toBe('custom');
    expect('notifiable' in line!).toBe(false); // no fan-out flag exists on a custom line
  });
});

/* api_admin_calendar_month aggregates session_occurrences + booking_items only, so a day whose ONLY
 * booking is a converted quote (booking_custom_items, zero booking_items) comes back with pax 0 — and
 * the month grid gates a cell's clickability on pax/cancelled, so that day was a dead, un-openable
 * cell and the drawer's custom-line union could never be reached. customLineDays is the month-wide
 * companion read: the set of Mauritius days that carry at least one VISIBLE custom/rental line, so the
 * grid can make those days clickable. It reuses mapDayCustomLines, so the same visibility filter
 * applies — an undated, draft, cancelled or refunded line marks no day. */
describe('customLineDays', () => {
  it('marks the Mauritius day a visible custom line falls on', () => {
    const days = customLineDays([customItem({ starts_at: '2026-08-18T05:00:00Z' })]);
    expect(days.has('2026-08-18')).toBe(true);
    expect(days.size).toBe(1);
  });

  it('marks a rental line’s day too', () => {
    const days = customLineDays([
      customItem({
        kind: 'rental',
        rental_vehicle_slug: 'nissan-kicks',
        starts_at: '2026-08-20T06:00:00Z',
      }),
    ]);
    expect(days.has('2026-08-20')).toBe(true);
  });

  // The +04:00 shift must be applied: 21:00 UTC on the 18th is 01:00 on the 19th in Mauritius, so the
  // line belongs to the 19th — the same day the drawer (via mauritiusDayBounds) would open it on.
  it('groups a late-evening line onto the Mauritius day, not the UTC day', () => {
    const days = customLineDays([customItem({ starts_at: '2026-08-18T21:00:00Z' })]);
    expect(days.has('2026-08-19')).toBe(true);
    expect(days.has('2026-08-18')).toBe(false);
  });

  it('marks no day when there are no custom lines', () => {
    expect(customLineDays([]).size).toBe(0);
  });

  // The whole point: a converted quote with only confirmed/completed/held/payment_pending custom lines
  // must light its day up, or the drawer can never be opened for it.
  it('treats confirmed, completed, held and payment_pending lines as live', () => {
    for (const status of ['confirmed', 'completed', 'held', 'payment_pending'] as const) {
      expect(
        customLineDays([customItem({ bookings: booking({ status }) })]).has('2026-08-18'),
      ).toBe(true);
    }
  });

  // Visibility filter: a non-live line must NOT make the day clickable, or staff open an empty drawer.
  it('marks no day for a line whose owning booking is not live', () => {
    for (const status of [
      'draft',
      'expired',
      'cancelled',
      'refund_pending',
      'refunded',
      'failed',
    ] as const) {
      expect(customLineDays([customItem({ bookings: booking({ status }) })]).size).toBe(0);
    }
  });

  it('marks no day for an undated line (the date is still to be agreed)', () => {
    expect(customLineDays([customItem({ starts_at: null })]).size).toBe(0);
  });

  it('collapses several lines on one day to a single day key', () => {
    const days = customLineDays([
      customItem({ id: 'ci1', starts_at: '2026-08-18T05:00:00Z' }),
      customItem({ id: 'ci2', kind: 'rental', starts_at: '2026-08-18T09:00:00Z' }),
    ]);
    expect(days.size).toBe(1);
    expect(days.has('2026-08-18')).toBe(true);
  });
});
