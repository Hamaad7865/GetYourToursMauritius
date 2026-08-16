/**
 * Weekday helpers for the per-option "Runs on" availability control.
 *
 * UI order is Monday-first (Mon…Sun), matching the booking/admin calendars. Storage is
 * `activity_options.closed_weekdays`: ISO weekday numbers (Mon=1 … Sun=7) the option does NOT run;
 * empty = runs every day. The control shows AVAILABLE days (checked = runs), so these two pure
 * functions convert between the seven booleans and the stored closed-day array. Kept dependency-free
 * so they unit-test without the browser Supabase client.
 */

/** Monday-first weekday labels, matching the booking calendar's WEEKDAYS row. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** ISO weekday for a Monday-first index: 0=Mon → 1 … 6=Sun → 7. */
const isoFromIndex = (i: number): number => i + 1;

/** Seven "runs on this day" booleans (Mon…Sun) → the ISO weekdays that are OFF (closed_weekdays). */
export function availableToClosedWeekdays(available: readonly boolean[]): number[] {
  const closed: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    if (!available[i]) closed.push(isoFromIndex(i));
  }
  return closed;
}

/** Stored closed_weekdays (ISO) → seven "runs on this day" booleans (Mon…Sun). Empty/unknown = all on. */
export function closedWeekdaysToAvailable(closed: readonly number[] | null | undefined): boolean[] {
  const off = new Set(closed ?? []);
  return Array.from({ length: 7 }, (_, i) => !off.has(isoFromIndex(i)));
}
