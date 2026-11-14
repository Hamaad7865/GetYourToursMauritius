import { partyChip, resolvePickup, type ChipSpec } from '@/components/admin/BookingFacts';
import {
  capacityUse,
  dayNumber,
  durationLabel,
  LINE_TYPES,
  MONTHS,
  PEOPLE_TYPES,
  toCalLines,
  WEEKDAYS,
  weekdayIndex,
  yearMonth,
  type CalLine,
} from './calendar-view';
import { guestPickup, type DayBooking, type DayDeparture, type DayEntry } from './calendar';
import { euro } from './dashboard';
import type { PaymentView } from './bookings';
import { fmtDate, fmtDateShort } from './format';

/**
 * THE PRINTED RUN SHEET: one day, for the driver and the guide, from the SAME `loadDaySchedule`
 * entries the Calendar's day sheet draws. Pure — the page prints it with `window.print()` and nothing
 * leaves the browser.
 *
 * It says what the day sheet says, in plain words that read without colour: per departure, the time,
 * tour and option, called off or not; per party, the name, headcount, pickup place and time, room,
 * phone, flight, child seats, extras, route and the team's note. Payment (paid, or the balance owed)
 * is printed only for someone who sees money on the day sheet. Times come only from the calendar's
 * own readers (`departureHeaderTime` via the calendar line, `guestPickup`) — never the slot's
 * placeholder clock.
 */

export interface RunSheetFact {
  k: string;
  v: string;
}

export interface RunSheetParty {
  key: string;
  name: string;
  ref: string;
  /** "2 × Adult · 1 × Child", "3 guests", "4 pax". */
  guests: string;
  /** Still in checkout: not on the trip yet unless they pay. */
  unpaid: boolean;
  /** The pickup place as stored (a "Pinned location (…)" is named by the screen), or null. */
  pickupPlace: string | null;
  /** "08:15", "15 Nov, 08:15", "To be arranged", "Makes own way", "Not provided yet"… */
  pickupNote: string | null;
  facts: RunSheetFact[];
  /** Only with money: the party's payment chip and any balance genuinely owed. */
  payment: ChipSpec | null;
  balanceDue: string | null;
}

export interface RunSheetBlock {
  key: string;
  /** "07:30", "Time TBC" or "All day". */
  time: string;
  title: string;
  subtitle: string | null;
  kind: string;
  calledOff: boolean;
  /** "8 guests · +2 unpaid · 8 of 12 · 3 h" — the line's headline numbers. */
  summary: string;
  parties: RunSheetParty[];
}

export interface RunSheet {
  day: string;
  /** "Saturday 14 November 2026". */
  title: string;
  /** "4 departures, 23 guests" (+ ", 1 called off"). */
  totals: string;
  blocks: RunSheetBlock[];
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Saturday 14 November 2026" — built from the calendar's own names, never the browser's locale. */
function longDay(day: string): string {
  const [y, m0] = yearMonth(day);
  return `${WEEKDAYS[weekdayIndex(day)]} ${dayNumber(day)} ${MONTHS[m0]} ${y}`;
}

function missing(upcoming: boolean): string {
  return upcoming ? 'Not provided yet' : 'Not recorded';
}

function pickupOf(
  b: {
    pickupLocation: string | null;
    dropoffLocation: string | null;
    pickupPending: boolean;
    transportPickup: string | null;
    transportDropoff: string | null;
  },
  direction: string | null,
  upcoming: boolean,
): { place: string | null; note: string | null; dropoff: string | null } {
  const { pickup, dropoff } = resolvePickup({ ...b, transferDirection: direction });
  const drop =
    dropoff.kind === 'text' ? dropoff.text : dropoff.kind === 'same' ? 'Same as pickup' : null;
  if (pickup.kind === 'text') {
    return {
      place: pickup.text,
      note: pickup.roundTrip ? 'Round-trip transfer' : null,
      dropoff: drop,
    };
  }
  if (pickup.kind === 'pending') {
    return { place: null, note: upcoming ? 'To be arranged' : 'Not recorded', dropoff: drop };
  }
  return { place: null, note: 'Makes own way', dropoff: drop };
}

function contactFacts(phone: string | null, staffNote: string | null): RunSheetFact[] {
  const out: RunSheetFact[] = [];
  if (phone) out.push({ k: 'Phone', v: phone });
  if (staffNote) out.push({ k: 'Notes', v: staffNote });
  return out;
}

function money(
  show: boolean,
  p: {
    status: DayBooking['status'];
    counted: boolean;
    payView: PaymentView;
    balanceDueEur: number;
  },
): Pick<RunSheetParty, 'payment' | 'balanceDue'> {
  if (!show) return { payment: null, balanceDue: null };
  const chip = partyChip(p);
  return {
    payment: chip,
    balanceDue:
      chip.label === 'Part paid' && p.balanceDueEur > 0
        ? `${euro(p.balanceDueEur)} still owed`
        : null,
  };
}

function departureParty(
  b: DayBooking,
  d: DayDeparture,
  upcoming: boolean,
  showMoney: boolean,
): RunSheetParty {
  const t = b.transfer;
  const when = guestPickup(b, d);
  const pick = pickupOf(b, t?.direction ?? null, upcoming);
  const facts: RunSheetFact[] = [];
  if (pick.dropoff) facts.push({ k: 'Drop-off', v: pick.dropoff });
  if (b.roomOrCabin) facts.push({ k: 'Room', v: b.roomOrCabin });
  if (t) {
    if (t.direction !== 'departure') {
      const inbound = [t.flightNumber, t.arrivalTime && `lands ${t.arrivalTime}`]
        .filter(Boolean)
        .join(' · ');
      facts.push({ k: 'Flight', v: t.flightNumber ? inbound : missing(upcoming) });
    }
    if (t.direction === 'departure' || t.direction === 'return') {
      const outbound = [
        t.departureFlightNumber,
        [t.returnDate ? fmtDate(t.returnDate) : null, t.returnTime].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(' · ');
      facts.push({
        k: t.direction === 'return' ? 'Return' : 'Flight',
        v: outbound || missing(upcoming),
      });
    }
    if (t.luggageDetails) facts.push({ k: 'Luggage', v: t.luggageDetails });
  }
  if (b.childSeats > 0) {
    facts.push({
      k: 'Child seats',
      v: `${plural(b.childSeats, 'seat')} to fit${t?.childSeatAge != null ? ` · child aged ${t.childSeatAge}` : ''}`,
    });
  }
  if (b.supplements.length > 0) {
    facts.push({ k: 'Extras', v: b.supplements.map((s) => `${s.qty} × ${s.name}`).join(', ') });
  }
  if (b.customItinerary && b.customItinerary.length > 0) {
    facts.push({
      k: 'Route',
      v: b.customItinerary.map((s) => (s.area ? `${s.title} (${s.area})` : s.title)).join(' → '),
    });
  }
  facts.push(...contactFacts(b.customerPhone, b.staffNote));
  const pickupNote = [when?.label ?? null, pick.note].filter(Boolean).join(' · ') || null;
  return {
    key: b.id,
    name: b.customerName || 'Guest',
    ref: b.ref,
    guests: b.lines.map((l) => `${l.quantity} × ${l.label}`).join(' · ') || `${b.pax} pax`,
    unpaid: !b.counted,
    pickupPlace: pick.place,
    pickupNote,
    facts,
    ...money(showMoney, {
      status: b.status,
      counted: b.counted,
      payView: b.payView ?? b.paymentState,
      balanceDueEur: b.balanceDueEur,
    }),
  };
}

function lineParties(line: CalLine, upcoming: boolean, showMoney: boolean): RunSheetParty[] {
  const e = line.entry;
  if (e.kind === 'occurrence')
    return e.bookings.map((b) => departureParty(b, e, upcoming, showMoney));
  if (e.kind === 'custom') {
    const rental = e.lineKind === 'rental';
    const facts: RunSheetFact[] = [];
    let place: string | null = null;
    let note: string | null = null;
    if (!rental) {
      const pick = pickupOf(
        {
          pickupLocation: e.pickupLabel,
          dropoffLocation: null,
          pickupPending: false,
          transportPickup: e.transportPickup,
          transportDropoff: e.transportDropoff,
        },
        null,
        upcoming,
      );
      place = pick.place;
      note = pick.note;
      if (pick.dropoff) facts.push({ k: 'Drop-off', v: pick.dropoff });
    } else if (e.endsAt) {
      facts.push({ k: 'Return', v: fmtDateShort(e.endsAt) });
    }
    if (e.quantity > 1) facts.push({ k: rental ? 'Vehicles' : 'Quantity', v: String(e.quantity) });
    if (e.roomOrCabin) facts.push({ k: 'Room', v: e.roomOrCabin });
    facts.push({ k: 'Booked as', v: e.description });
    facts.push(...contactFacts(e.customerPhone, e.staffNote));
    return [
      {
        key: e.bookingId,
        name: e.customerName || 'Guest',
        ref: e.ref,
        guests: e.guests != null ? plural(e.guests, 'guest') : '',
        unpaid: !e.counted,
        pickupPlace: place,
        pickupNote: note,
        facts,
        ...money(showMoney, {
          status: e.status,
          counted: e.counted,
          payView: e.payView ?? e.paymentState,
          balanceDueEur: e.balanceDueEur,
        }),
      },
    ];
  }
  const facts: RunSheetFact[] = [
    {
      k: 'Drop-off',
      v: e.dropoff ? e.dropoff.replace(/\(\s*arrivals\s*\)/i, '(departures)') : 'Airport',
    },
    { k: 'Flight', v: e.flightNumber ?? missing(upcoming) },
  ];
  if (e.roomOrCabin) facts.push({ k: 'Room', v: e.roomOrCabin });
  facts.push(...contactFacts(e.customerPhone, e.staffNote));
  return [
    {
      key: e.bookingId,
      name: e.customerName || 'Guest',
      ref: e.ref,
      guests: [e.vehicleLabel, e.pax ? `${e.pax} pax` : null].filter(Boolean).join(' · '),
      unpaid: !e.counted,
      pickupPlace: e.pickup,
      pickupNote: e.pickup ? e.departureTime : missing(upcoming),
      facts,
      ...money(showMoney, {
        status: e.status,
        counted: e.counted,
        payView: e.payView ?? e.paymentState,
        balanceDueEur: e.balanceDueEur,
      }),
    },
  ];
}

function lineSummary(line: CalLine): string {
  const parts: string[] = [];
  if (PEOPLE_TYPES.has(line.type)) {
    parts.push(plural(line.guests, 'guest'));
    if (line.pendingGuests) parts.push(`+${line.pendingGuests} unpaid`);
  }
  const use = capacityUse(line.entry);
  if (use) parts.push(use.label);
  if (line.durationMinutes) parts.push(durationLabel(line.durationMinutes));
  return parts.join(' · ');
}

/** One day's printed run sheet, as of the Mauritius day `today`. */
export function runSheet(
  entries: readonly DayEntry[],
  day: string,
  today: string,
  opts: { showMoney: boolean },
): RunSheet {
  const lines = toCalLines([...entries], today).filter((l) => l.day === day);
  const upcoming = day >= today;
  const live = lines.filter((l) => !l.cancelled && PEOPLE_TYPES.has(l.type));
  const calledOff = lines.filter((l) => l.cancelled).length;
  const totals = [
    plural(live.length, 'departure'),
    plural(
      live.reduce((s, l) => s + l.guests, 0),
      'guest',
    ),
    ...(calledOff ? [`${calledOff} called off`] : []),
  ].join(', ');
  return {
    day,
    title: longDay(day),
    totals,
    blocks: lines.map((l) => ({
      key: l.key,
      time: l.allDay ? 'All day' : (l.time ?? 'Time TBC'),
      title: l.title,
      subtitle: l.subtitle,
      kind: LINE_TYPES[l.type].singular,
      calledOff: l.cancelled,
      summary: lineSummary(l),
      parties: lineParties(l, upcoming, opts.showMoney),
    })),
  };
}
