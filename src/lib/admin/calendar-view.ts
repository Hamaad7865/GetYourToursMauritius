import { resolvePickup } from '@/components/admin/BookingFacts';
import { departureClock } from '@/lib/catalogue/departure-time';
import {
  customLineLabel,
  departureHeaderTime,
  mauritiusDayKey,
  type DayBooking,
  type DayCustomLine,
  type DayDeparture,
  type DayEntry,
  type MoveTarget,
} from './calendar';

/* The operations calendar's view-model. Pure: it turns the loaded day-sheet entries into what the
 * month grid, the week columns and the day panel draw — line types, attention flags, the period's
 * figures, the timeline — so every rule here is testable without a browser or a database. Days are
 * Mauritius calendar days ("YYYY-MM-DD"); "today" is always passed in, never read from the clock. */

// ── Days ────────────────────────────────────────────────────────────────────────────────────────

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const pad = (n: number) => String(n).padStart(2, '0');

function toDate(day: string): Date {
  return new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
}
export function dayOf(y: number, m0: number, d: number): string {
  const t = new Date(Date.UTC(y, m0, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function addDays(day: string, n: number): string {
  const t = toDate(day);
  return dayOf(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + n);
}
/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: string): number {
  return (toDate(day).getUTCDay() + 6) % 7;
}
export function mondayOf(day: string): string {
  return addDays(day, -weekdayIndex(day));
}
export function yearMonth(day: string): [number, number] {
  return [+day.slice(0, 4), +day.slice(5, 7) - 1];
}
export function dayNumber(day: string): number {
  return +day.slice(8, 10);
}
/** "Mon 26 Oct". */
export function shortDay(day: string): string {
  return `${WEEKDAYS[weekdayIndex(day)]!.slice(0, 3)} ${dayNumber(day)} ${MONTHS[yearMonth(day)[1]]!.slice(0, 3)}`;
}

/** The days a month view covers: Monday on or before the 1st to the Sunday on or after the last. */
export function monthGridRange(
  y: number,
  m0: number,
): { first: string; last: string; from: string; to: string } {
  const first = dayOf(y, m0, 1);
  const last = dayOf(y, m0 + 1, 0);
  return { first, last, from: mondayOf(first), to: addDays(mondayOf(last), 6) };
}

/** Minutes past midnight in Mauritius (UTC+4, no DST) for an instant — staff abroad still see MU time. */
export function mauritiusMinutes(now: Date): number {
  const shifted = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

// ── Times ───────────────────────────────────────────────────────────────────────────────────────

export function toMinutes(hhmm: string): number {
  return +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
}
export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
/** "8 h", "7 h 30 min", "45 min". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const r = minutes % 60;
  return [h ? `${h} h` : '', r ? `${r} min` : ''].filter(Boolean).join(' ');
}

// ── Types ───────────────────────────────────────────────────────────────────────────────────────

export type LineType = 'tour' | 'sea' | 'transfer' | 'rental' | 'extra';

/** The calendar's colour key. Data-driven, so components apply these through `style`, not classes. */
export const LINE_TYPES: Record<
  LineType,
  { label: string; singular: string; dot: string; tint: string; ink: string }
> = {
  tour: { label: 'Tours', singular: 'Tour', dot: '#0f9a8a', tint: '#e2f3ef', ink: '#0b5c53' },
  sea: {
    label: 'Sea & boats',
    singular: 'Sea trip',
    dot: '#2b6fd6',
    tint: '#e6eefc',
    ink: '#1d4f9e',
  },
  transfer: {
    label: 'Transfers',
    singular: 'Transfer',
    dot: '#d4891a',
    tint: '#fcf0dc',
    ink: '#8a5409',
  },
  rental: {
    label: 'Car rental',
    singular: 'Car rental',
    dot: '#8a56c8',
    tint: '#f2e9fb',
    ink: '#5b3391',
  },
  extra: {
    label: 'Fees & extras',
    singular: 'Fee',
    dot: '#7b8a91',
    tint: '#edf1f2',
    ink: '#4a575d',
  },
};
export const TYPE_ORDER: LineType[] = ['tour', 'sea', 'transfer', 'rental', 'extra'];
/** Lines that carry guests: they are the "departures" and make up the headcount. */
export const PEOPLE_TYPES: ReadonlySet<LineType> = new Set(['tour', 'sea', 'transfer']);

const TRANSFER_WORDS = /\btransfers?\b|\bairport\b|a[ée]roport/i;
/** Catalogue categories that are on the water ("Catamaran cruises", "Speedboat Tours", …). */
const SEA_CATEGORY = /cruise|catamaran|boat|\bsea\b|water|snorkel|dolphin|whale|diving|fishing/i;
/** The same, for a quote line's free-text description (often French). A HEURISTIC: a quote line has no
 *  category, so this reads its words; anything it does not recognise is a tour. */
const SEA_WORDS =
  /catamaran|boat|bateau|cruise|croisi[eè]re|dolphin|dauphin|whale|baleine|snorkel|speed ?boat|île aux|ile aux|islands?\b|\bîles?\b|nage|swim|diving|plong[ée]e|fishing|p[eê]che|kayak|parasail|submarine|sous-marin/i;
const FEE_WORDS = /\blevy\b|\btax\b|\bfees?\b|entrance|entr[ée]e|ticket|billet|surcharge/i;

/** A booked departure's type: a transfer by product or party, a sea trip by category, else a tour. */
export function departureType(d: DayDeparture): LineType {
  if (
    d.isAirportTransfer ||
    d.bookings.some((b) => b.transfer != null || b.pickupTime != null) ||
    TRANSFER_WORDS.test(d.category ?? '')
  )
    return 'transfer';
  if (SEA_CATEGORY.test(d.category ?? '')) return 'sea';
  return 'tour';
}

/** A quote line's type, from its kind and (heuristically) its words. */
export function customLineType(l: Pick<DayCustomLine, 'lineKind' | 'description'>): LineType {
  if (l.lineKind === 'rental') return 'rental';
  const label = customLineLabel(l.description);
  if (TRANSFER_WORDS.test(label)) return 'transfer';
  if (FEE_WORDS.test(label)) return 'extra';
  if (SEA_WORDS.test(label)) return 'sea';
  return 'tour';
}

// ── Lines ───────────────────────────────────────────────────────────────────────────────────────

/** One thing on the calendar: a booked departure, a dated quote line, or a return transfer's leg. */
export interface CalLine {
  /** Stable across reloads: `occ-…`, `ci-…`, `rl-…`. */
  key: string;
  day: string;
  type: LineType;
  title: string;
  /** The option ("Private group"), the full quote description, or the vehicle. */
  subtitle: string | null;
  /** "HH:MM" the line starts, or null: no time set (a tour) or no time at all (a rental, a fee). */
  time: string | null;
  durationMinutes: number | null;
  /** Rentals and fees run the whole day; they sit under "All day", not on the timeline. */
  allDay: boolean;
  /** Guests on paid parties. Zero on a rental or a fee, which carry no headcount. */
  guests: number;
  /** Guests on parties still mid-checkout. */
  pendingGuests: number;
  /** What the line is booked for (paid parties), EUR. */
  valueEur: number;
  cancelled: boolean;
  fromQuote: boolean;
  /** Each party's attention flags, keyed by booking id — see {@link partyFlags}. */
  partyFlags: Record<string, string[]>;
  /** The distinct flags across its parties, in a stable order. */
  flags: string[];
  /** How many parties have at least one flag. */
  flaggedParties: number;
  parties: number;
  leadName: string | null;
  /** Where it starts, short ("LUX* Belle Mare +1", "MK 015 · lands 06:45"), or null. */
  where: string | null;
  /** The pickup or flight is still to be given — drawn amber. */
  whereMissing: boolean;
  entry: DayEntry;
}

const FLAG_ORDER = ['Unpaid', 'Pickup missing', 'Flight missing', 'Owes us an answer'];

/** The first comma-separated part of an address: the hotel, not its street. */
export function shortPlace(place: string): string {
  return place.split(',')[0]!.trim();
}

/** What still needs doing for one party on a live, upcoming line. Nothing on the past or called off. */
function flagsFor(
  live: boolean,
  party: {
    counted: boolean;
    pickupMissing?: boolean;
    flightMissing?: boolean;
    awaitingChoice?: boolean;
  },
): string[] {
  if (!live) return [];
  const out: string[] = [];
  if (!party.counted) out.push('Unpaid');
  if (party.pickupMissing) out.push('Pickup missing');
  if (party.flightMissing) out.push('Flight missing');
  if (party.awaitingChoice) out.push('Owes us an answer');
  return out;
}

/** A transfer party with no flight to meet: an arrival or a return needs the inbound flight, a
 *  departure the outbound one. */
function flightMissing(b: DayBooking): boolean {
  const t = b.transfer;
  if (!t) return false;
  return t.direction === 'departure' ? !t.departureFlightNumber : !t.flightNumber;
}

/** Where a party is collected, after the airport-departure flip and the round-trip transfer fold. */
function pickupText(b: DayBooking): string | null {
  const { pickup } = resolvePickup({
    pickupLocation: b.pickupLocation,
    dropoffLocation: b.dropoffLocation,
    pickupPending: b.pickupPending,
    transportPickup: b.transportPickup,
    transportDropoff: b.transportDropoff,
    transferDirection: b.transfer?.direction ?? null,
  });
  return pickup.kind === 'text' ? pickup.text : null;
}

function departureWhere(
  d: DayDeparture,
  type: LineType,
): { where: string | null; missing: boolean } {
  const lead = d.bookings[0];
  if (!lead) return { where: null, missing: false };
  const more = d.bookings.length > 1 ? ` +${d.bookings.length - 1}` : '';
  if (type === 'transfer' && lead.transfer) {
    if (lead.transfer.direction === 'departure') {
      const hotel = pickupText(lead);
      return hotel
        ? { where: `${shortPlace(hotel)} → airport${more}`, missing: false }
        : { where: 'Pickup not provided', missing: true };
    }
    const flight = [
      lead.transfer.flightNumber,
      lead.transfer.arrivalTime && `lands ${lead.transfer.arrivalTime}`,
    ]
      .filter(Boolean)
      .join(' · ');
    return flight
      ? { where: `${flight}${more}`, missing: !lead.transfer.flightNumber }
      : { where: 'Flight not provided', missing: true };
  }
  const withPickup = d.bookings.find((b) => pickupText(b));
  if (withPickup) return { where: `${shortPlace(pickupText(withPickup)!)}${more}`, missing: false };
  if (d.bookings.some((b) => b.pickupPending))
    return { where: 'Pickup to be arranged', missing: true };
  return { where: null, missing: false };
}

function finishFlags(partyFlags: Record<string, string[]>): {
  flags: string[];
  flaggedParties: number;
} {
  const seen = new Set<string>();
  let flaggedParties = 0;
  for (const list of Object.values(partyFlags)) {
    if (list.length) flaggedParties += 1;
    for (const f of list) seen.add(f);
  }
  return { flags: FLAG_ORDER.filter((f) => seen.has(f)), flaggedParties };
}

/** Turn one loaded entry into a calendar line. `today` is the Mauritius day. */
export function toCalLine(entry: DayEntry, today: string): CalLine {
  const day = mauritiusDayKey(entry.startsAt);
  const upcoming = day >= today;

  if (entry.kind === 'occurrence') {
    const type = departureType(entry);
    const cancelled = entry.status === 'cancelled';
    const live = upcoming && !cancelled;
    const partyFlags: Record<string, string[]> = {};
    for (const b of entry.bookings) {
      partyFlags[b.id] = flagsFor(live, {
        counted: b.counted,
        pickupMissing: b.pickupPending && !b.pickupLocation && !b.transportPickup,
        flightMissing: flightMissing(b),
        awaitingChoice: b.awaitingChoice,
      });
    }
    const { where, missing } = departureWhere(entry, type);
    return {
      key: `occ-${entry.occurrenceId}`,
      day,
      type,
      title: entry.activityTitle,
      subtitle:
        entry.optionName && entry.optionName !== entry.activityTitle ? entry.optionName : null,
      // A transfer card carries its parties' common pickup time; a tour its own start time.
      time: departureHeaderTime(entry),
      durationMinutes: entry.durationMinutes,
      allDay: false,
      guests: entry.pax,
      pendingGuests: entry.pendingPax,
      valueEur: entry.valueEur,
      cancelled,
      fromQuote: entry.bookings.some((b) => b.source === 'quote'),
      partyFlags,
      ...finishFlags(partyFlags),
      parties: entry.bookings.length,
      leadName: entry.bookings[0]?.customerName || null,
      where,
      whereMissing: missing && upcoming,
      entry,
    };
  }

  if (entry.kind === 'custom') {
    const type = customLineType(entry);
    const allDay = type === 'rental' || type === 'extra';
    const partyFlags = { [entry.bookingId]: flagsFor(upcoming, { counted: entry.counted }) };
    const pickup = entry.pickupLabel ?? entry.transportPickup;
    const label = customLineLabel(entry.description);
    return {
      key: `ci-${entry.id}`,
      day,
      type,
      title: label,
      subtitle: label !== entry.description.trim() ? entry.description : null,
      // A quote line's starts_at is the real time typed on the quote.
      time: allDay ? null : minutesOf(entry.startsAt),
      durationMinutes: null,
      allDay,
      guests: PEOPLE_TYPES.has(type) && entry.counted ? (entry.guests ?? 0) : 0,
      pendingGuests: PEOPLE_TYPES.has(type) && !entry.counted ? (entry.guests ?? 0) : 0,
      valueEur: entry.counted ? entry.valueEur : 0,
      cancelled: false,
      fromQuote: true,
      partyFlags,
      ...finishFlags(partyFlags),
      parties: 1,
      leadName: entry.customerName || null,
      where: pickup ? shortPlace(pickup) : null,
      whereMissing: false,
      entry,
    };
  }

  const partyFlags = {
    [entry.bookingId]: flagsFor(upcoming, {
      counted: entry.counted,
      flightMissing: !entry.flightNumber,
    }),
  };
  return {
    key: `rl-${entry.bookingId}`,
    day,
    type: 'transfer',
    title: 'Airport transfer — departure',
    subtitle: entry.vehicleLabel,
    time: departureClock(entry.departureTime),
    durationMinutes: null,
    allDay: false,
    guests: entry.counted ? entry.pax : 0,
    pendingGuests: entry.counted ? 0 : entry.pax,
    // Its fare is counted once, on the arrival departure that carries the booking line.
    valueEur: 0,
    cancelled: false,
    fromQuote: entry.source === 'quote',
    partyFlags,
    ...finishFlags(partyFlags),
    parties: 1,
    leadName: entry.customerName || null,
    where: entry.pickup ? `${shortPlace(entry.pickup)} → airport` : 'Pickup not provided',
    whereMissing: !entry.pickup && upcoming,
    entry,
  };
}

/** "HH:MM" of an instant in Mauritius time. */
function minutesOf(iso: string): string {
  return hhmm(mauritiusMinutes(new Date(iso)));
}

/** Timed lines first, earliest first; then untimed; ties by title. */
export function byTime(a: CalLine, b: CalLine): number {
  const ta = a.time ? toMinutes(a.time) : 9999;
  const tb = b.time ? toMinutes(b.time) : 9999;
  return ta - tb || a.title.localeCompare(b.title);
}

export function toCalLines(entries: DayEntry[], today: string): CalLine[] {
  return entries.map((e) => toCalLine(e, today)).sort(byTime);
}

export function linesByDay(lines: CalLine[]): Map<string, CalLine[]> {
  const out = new Map<string, CalLine[]>();
  for (const l of lines) {
    const bucket = out.get(l.day);
    if (bucket) bucket.push(l);
    else out.set(l.day, [l]);
  }
  for (const list of out.values()) list.sort(byTime);
  return out;
}

// ── Filters and the period's figures ────────────────────────────────────────────────────────────

export interface CalFilters {
  types: Record<LineType, boolean>;
  attentionOnly: boolean;
}
export const ALL_TYPES_ON: Record<LineType, boolean> = {
  tour: true,
  sea: true,
  transfer: true,
  rental: true,
  extra: true,
};

export function passes(l: CalLine, f: CalFilters): boolean {
  return f.types[l.type] && (!f.attentionOnly || l.flaggedParties > 0);
}

/** Paid guests on a day's live people-lines whose type is switched on. */
export function guestsOn(lines: CalLine[] | undefined, f: CalFilters): number {
  return (lines ?? []).reduce(
    (s, l) => s + (!l.cancelled && PEOPLE_TYPES.has(l.type) && f.types[l.type] ? l.guests : 0),
    0,
  );
}

export interface PeriodSummary {
  departures: number;
  calledOff: number;
  guests: number;
  /** The busiest day and its guests, or null when nobody is booked. */
  peak: { day: string; guests: number } | null;
  valueEur: number;
  /** Parties with something still to sort out. */
  attention: number;
  /** Live lines per type in the period — the chip counts (independent of the chips themselves). */
  typeCounts: Record<LineType, number>;
}

export function summarize(
  lines: CalLine[],
  from: string,
  to: string,
  f: CalFilters,
): PeriodSummary {
  const inPeriod = lines.filter((l) => l.day >= from && l.day <= to);
  const visible = inPeriod.filter((l) => f.types[l.type]);
  const live = visible.filter((l) => !l.cancelled);
  const people = live.filter((l) => PEOPLE_TYPES.has(l.type));
  const byDay = new Map<string, number>();
  for (const l of people) byDay.set(l.day, (byDay.get(l.day) ?? 0) + l.guests);
  let peak: PeriodSummary['peak'] = null;
  for (const [day, guests] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    if (guests > 0 && (!peak || guests > peak.guests)) peak = { day, guests };
  }
  const typeCounts = { tour: 0, sea: 0, transfer: 0, rental: 0, extra: 0 };
  for (const l of inPeriod) if (!l.cancelled) typeCounts[l.type] += 1;
  return {
    departures: people.length,
    calledOff: visible.filter((l) => l.cancelled).length,
    guests: people.reduce((s, l) => s + l.guests, 0),
    peak,
    valueEur: live.reduce((s, l) => s + l.valueEur, 0),
    attention: visible.reduce((s, l) => s + l.flaggedParties, 0),
    typeCounts,
  };
}

/** Rounded % change vs the previous period; null when it earned nothing (no fabricated figure). */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// ── Month grid ──────────────────────────────────────────────────────────────────────────────────

export interface MonthCell {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  weekend: boolean;
  /** The day's lines that pass the filters, earliest first. */
  items: CalLine[];
  guests: number;
  hasAttention: boolean;
  /** Guests against the month's busiest day, 0..1. */
  load: number;
}

export function monthCells(
  y: number,
  m0: number,
  byDay: Map<string, CalLine[]>,
  today: string,
  f: CalFilters,
): MonthCell[] {
  const { first, last, from, to } = monthGridRange(y, m0);
  let busiest = 1;
  for (let d = first; d <= last; d = addDays(d, 1))
    busiest = Math.max(busiest, guestsOn(byDay.get(d), f));
  const cells: MonthCell[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const all = byDay.get(d) ?? [];
    const guests = guestsOn(all, f);
    const items = all.filter((l) => passes(l, f));
    cells.push({
      day: d,
      inMonth: d >= first && d <= last,
      isToday: d === today,
      isPast: d < today,
      weekend: weekdayIndex(d) >= 5,
      items,
      guests,
      hasAttention: items.some((l) => l.flaggedParties > 0),
      load: guests / busiest,
    });
  }
  return cells;
}

// ── The day panel's timeline ────────────────────────────────────────────────────────────────────

export const TIMELINE_START = 6 * 60;
export const TIMELINE_END = 20 * 60;
/** A line with no known duration still gets a visible bar. */
const DEFAULT_BAR_MINUTES = 60;

export interface TimelineBar {
  key: string;
  type: LineType;
  lane: number;
  /** 0..1 across 06:00–20:00. */
  left: number;
  width: number;
  label: string;
}

/** Live, timed lines as bars, each in the first lane free when it starts. */
export function timelineBars(lines: CalLine[]): { bars: TimelineBar[]; lanes: number } {
  const laneEnds: number[] = [];
  const bars: TimelineBar[] = [];
  const span = TIMELINE_END - TIMELINE_START;
  for (const l of [...lines].sort(byTime)) {
    if (l.cancelled || l.allDay || !l.time) continue;
    const start = toMinutes(l.time);
    const end = start + (l.durationMinutes ?? DEFAULT_BAR_MINUTES);
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane < 0) {
      laneEnds.push(end);
      lane = laneEnds.length - 1;
    } else laneEnds[lane] = end;
    const x0 = Math.max(0, (start - TIMELINE_START) / span);
    const x1 = Math.min(1, (end - TIMELINE_START) / span);
    if (x1 <= 0 || x0 >= 1) continue;
    bars.push({
      key: l.key,
      type: l.type,
      lane,
      left: x0,
      width: Math.max(0.015, x1 - x0),
      label: `${l.time}${l.durationMinutes ? `–${hhmm(end)}` : ''} · ${l.title}`,
    });
  }
  return { bars, lanes: Math.max(1, laneEnds.length) };
}

// ── Moving a departure ──────────────────────────────────────────────────────────────────────────

export interface PickerDay {
  day: string;
  /** The open departure of the same option on that day, when it has room for the whole party. */
  target: MoveTarget | null;
  seatsLeft: number | null;
  past: boolean;
  current: boolean;
  disabled: boolean;
  /** Why it cannot be picked, for its tooltip. */
  reason: string | null;
}

/**
 * Three weeks of days to move a departure to, from the Monday of its week (or of this week, once it is
 * in the past). A day is pickable only when the same option runs then with room for every unit moving —
 * the RPC re-checks, but offering a day that is bound to fail would only produce an error.
 */
export function movePickerDays(
  departureDay: string,
  today: string,
  targets: MoveTarget[],
  unitsNeeded: number,
): PickerDay[] {
  const byDay = new Map<string, MoveTarget>();
  for (const t of targets) {
    const d = mauritiusDayKey(t.startsAt);
    if (!byDay.has(d)) byDay.set(d, t);
  }
  const start = mondayOf(departureDay < today ? today : departureDay);
  const out: PickerDay[] = [];
  for (let i = 0; i < 21; i++) {
    const day = addDays(start, i);
    const target = byDay.get(day) ?? null;
    const past = day < today;
    const current = day === departureDay;
    const full = target != null && target.seatsLeft < unitsNeeded;
    const reason = past
      ? 'In the past'
      : current
        ? 'This is its current day'
        : !target
          ? 'This tour does not run that day'
          : full
            ? target.seatsLeft === 0
              ? 'Full'
              : `Only ${target.seatsLeft} left`
            : null;
    out.push({
      day,
      target: full ? null : target,
      seatsLeft: target?.seatsLeft ?? null,
      past,
      current,
      disabled: reason != null,
      reason,
    });
  }
  return out;
}

// ── Changing a departure's time ─────────────────────────────────────────────────────────────────

/** Half-hour steps around the tour's usual time, kept to a sensible day. */
export function timePresets(anchor: number): number[] {
  return [-90, -60, -30, 0, 30, 60, 90]
    .map((o) => anchor + o)
    .filter((m) => m >= 5 * 60 && m <= 23 * 60);
}

/** A plain warning for a start time that is probably a mistake, or null. */
export function timeWarning(start: number, durationMinutes: number | null): string | null {
  if (start < 6 * 60) return 'Starts before 06:00.';
  if (durationMinutes && start + durationMinutes > 21 * 60) return 'Finishes after 21:00.';
  return null;
}

/** "1 h 30 min later", "45 min earlier". */
export function shiftLabel(deltaMinutes: number): string {
  return `${durationLabel(Math.abs(deltaMinutes))} ${deltaMinutes > 0 ? 'later' : 'earlier'}`;
}
