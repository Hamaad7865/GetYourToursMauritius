/* Shared back-office formatting.
 *
 * Every departure and timestamp in admin is rendered in Mauritius local time, never the staff
 * member's own timezone — the operational day must be the same day for everyone looking at it. That
 * is the display-side twin of `mauritiusDayBounds()` on the query side.
 *
 * These lived as private copies inside AdminBookings; the calendar's day sheet now shows the same
 * facts, and two screens quietly disagreeing about what time a departure leaves is exactly the class
 * of bug the constant offset was introduced to kill. */

import { transferLegs } from '@/lib/transfers/leg-times';
import type { AdminTransferDetails } from './bookings';

export const TZ = 'Indian/Mauritius';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: TZ,
});
const dateShortFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TZ,
});
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TZ,
});

/** "18 Aug 2026", or an em dash for a null/unparseable instant. */
export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

/** "18 Aug" — for dense table cells where the year is implied. */
export function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateShortFmt.format(d);
}

/** "09:00" in Mauritius time. */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : timeFmt.format(d);
}

/** "18 Aug 2026, 09:00". */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

export function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** YYYY-MM-DD in Mauritius local time. */
export function mauDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}

/** When a booking's guest is actually collected — see {@link serviceWhen}. */
export interface ServiceWhen {
  /** The Mauritius calendar day, YYYY-MM-DD. */
  day: string;
  /** The clock time to print, or null when the guest gave none — show the day alone, never a guess. */
  time: string | null;
  /** A sortable instant for `day` + `time` (noon when there is no time); compare with Date.parse. */
  at: string;
}

/**
 * When the guest is collected, for every back-office date/time cell.
 *
 * Every day-slot is materialised at a placeholder clock time (`materialize_availability` puts it at
 * noon; slots made before the July timezone fix sit at 16:00), so an occurrence's clock is never real.
 * A transfer's pickup is what the guest typed: the first leg from {@link transferLegs} — so a
 * departure-only trip is dated by its return_date, not the slot — or a hotel-to-hotel transfer's
 * `pickupTime`. A tour leaves at the start time set on it (`departureTime`, see
 * `@/lib/catalogue/departure-time`). Anything with no time gets its day alone. The admin twin of the
 * invoice's Date line, so the back-office and the guest's documents agree on when the car comes.
 */
export function serviceWhen(b: {
  startsAt: string | null;
  transfer: Pick<
    AdminTransferDetails,
    'direction' | 'arrivalTime' | 'returnDate' | 'returnTime'
  > | null;
  pickupTime: string | null;
  /** The tour's departure ("HH:MM") from its option/activity start time; null when none is set. */
  departureTime: string | null;
}): ServiceWhen | null {
  // The slot's MAURITIUS day — transferLegs reads the first 10 characters as the date, which on a raw
  // UTC ISO is only right while every slot sits at noon.
  const slotDay = b.startsAt ? mauDay(b.startsAt) : null;
  const tr = b.transfer;
  if (tr) {
    const [leg] = transferLegs({
      direction: tr.direction,
      serviceDateIso: slotDay,
      arrivalTime: tr.arrivalTime,
      returnDate: tr.returnDate,
      returnTime: tr.returnTime,
    });
    if (leg) return at(leg.pickupYmd, leg.pickupTime);
    const day = tr.direction === 'departure' && tr.returnDate ? tr.returnDate : slotDay;
    return day ? at(day, null) : null;
  }
  if (!b.startsAt || !slotDay) return null;
  return at(slotDay, b.pickupTime || b.departureTime);
}

function at(day: string, time: string | null): ServiceWhen {
  const t = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  const hhmm = t ? `${t[1]!.padStart(2, '0')}:${t[2]}` : '12:00';
  return { day, time: time?.trim() || null, at: `${day}T${hhmm}:00+04:00` };
}
