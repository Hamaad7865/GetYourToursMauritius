/* Shared back-office formatting.
 *
 * Every departure and timestamp in admin is rendered in Mauritius local time, never the staff
 * member's own timezone — the operational day must be the same day for everyone looking at it. That
 * is the display-side twin of `mauritiusDayBounds()` on the query side.
 *
 * These lived as private copies inside AdminBookings; the calendar's day sheet now shows the same
 * facts, and two screens quietly disagreeing about what time a departure leaves is exactly the class
 * of bug the constant offset was introduced to kill. */

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
