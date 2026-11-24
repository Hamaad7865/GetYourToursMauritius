/**
 * Closed dates: one-off days a tour takes no NEW bookings (the boat is full from another channel, a
 * private hire, a holiday). All the rules live here and in availability-write.ts — no SQL function.
 *
 * Mechanism: a closed day is that day's slot (`session_occurrences`) with `capacity = 0`.
 *   * create_hold refuses it (`insufficient_capacity`) and api_list_availability reports 0 seats, so the
 *     customer calendar greys the day out — no change to either.
 *   * The five-minute cron's materialize_availability never rewrites an EXISTING slot's capacity (it only
 *     inserts missing days and flips `status`), so a closure survives it. That is why this is capacity
 *     and not `status = 'closed'`, which the cron reopens.
 *   * The capacity editors (set_daily_capacity_atomic) DO overwrite future capacities, so the admin
 *     wrappers snapshot the closed days first and re-apply them after (availability-write.ts).
 *   * Guests already booked on a closed day keep their booking; the day just stops selling.
 *
 * Kept dependency-free so it unit-tests without the browser Supabase client.
 */

/** Longest range one action may close — the same horizon materialize_availability caps at. */
export const MAX_CLOSED_RANGE_DAYS = 400;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAURITIUS_OFFSET_MS = 4 * 60 * 60 * 1000; // UTC+4, no DST

function toUtcDate(day: string): Date {
  return new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isDayKey(s: string): boolean {
  return DAY_RE.test(s) && dayKey(toUtcDate(s)) === s;
}

export function addDayKeys(day: string, n: number): string {
  const d = toUtcDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dayKey(d);
}

/** The Mauritius calendar day ('YYYY-MM-DD') an instant falls on. */
export function mauritiusDay(at: Date | string): string {
  return dayKey(new Date(new Date(at).getTime() + MAURITIUS_OFFSET_MS));
}

/** ISO weekday (Mon=1 … Sun=7) of a day key — the numbering `closed_weekdays` stores. */
export function isoWeekday(day: string): number {
  const dow = toUtcDate(day).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** The UTC instant of Mauritius midnight starting `day`. */
export function mauritiusDayStartUtc(day: string): string {
  return new Date(toUtcDate(day).getTime() - MAURITIUS_OFFSET_MS).toISOString();
}

/** Where materialize_availability puts every day's slot: 12:00 Mauritius. */
export function slotStartUtc(day: string): string {
  return new Date(
    toUtcDate(day).getTime() + 12 * 60 * 60 * 1000 - MAURITIUS_OFFSET_MS,
  ).toISOString();
}

/** Every day key from `from` to `to`, inclusive. Empty when `to` is before `from`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDayKeys(d, 1)) out.push(d);
  return out;
}

export interface DayRange {
  from: string;
  to: string;
  days: number;
}

/** Sorted, de-duplicated day keys → runs of consecutive days ("24–29 Nov" rather than six rows). */
export function groupIntoRanges(days: Iterable<string>): DayRange[] {
  const sorted = [...new Set(days)].sort();
  const out: DayRange[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && addDayKeys(last.to, 1) === d) {
      last.to = d;
      last.days += 1;
    } else {
      out.push({ from: d, to: d, days: 1 });
    }
  }
  return out;
}

/**
 * Validate a from/to pair and clamp its start to `today` (a past day has nothing left to sell).
 * Throws a message fit to show the owner.
 */
export function normaliseClosedRange(
  from: string,
  to: string,
  today: string,
): { from: string; to: string } {
  if (!isDayKey(from) || !isDayKey(to)) throw new Error('Pick a valid start and end date.');
  if (to < from) throw new Error('The end date is before the start date.');
  if (to < today) throw new Error('Those dates are already in the past.');
  const start = from < today ? today : from;
  if (daysBetween(start, to).length > MAX_CLOSED_RANGE_DAYS) {
    throw new Error(`Close at most ${MAX_CLOSED_RANGE_DAYS} days at a time.`);
  }
  return { from: start, to };
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Tue 24 Nov" / "Tue 24 – Sun 29 Nov" / "Mon 28 Dec – Sun 3 Jan 2027" for a range card. */
export function formatDayRange(r: { from: string; to: string }, today: string): string {
  const fmt = (day: string, withMonth: boolean, withYear: boolean) => {
    const d = toUtcDate(day);
    return [
      WEEKDAY_SHORT[d.getUTCDay()],
      d.getUTCDate(),
      withMonth ? MONTH_SHORT[d.getUTCMonth()] : null,
      withYear ? d.getUTCFullYear() : null,
    ]
      .filter((p) => p != null)
      .join(' ');
  };
  const thisYear = today.slice(0, 4);
  const toYear = r.to.slice(0, 4) !== thisYear;
  if (r.from === r.to) return fmt(r.from, true, toYear);
  const sameMonth = r.from.slice(0, 7) === r.to.slice(0, 7);
  const fromYear = r.from.slice(0, 4) !== r.to.slice(0, 4) && r.from.slice(0, 4) !== thisYear;
  return `${fmt(r.from, !sameMonth, fromYear)} – ${fmt(r.to, true, toYear)}`;
}
