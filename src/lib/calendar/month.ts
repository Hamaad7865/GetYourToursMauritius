/** Shared month-grid maths for the app's calendars (booking widget + trip range picker), so both
 *  lay out weeks identically. Monday-first, matching the WEEKDAYS row they render. */

/**
 * One month as calendar cells: leading `null`s pad the first row to the correct weekday, then a Date
 * per day. Monday-first (JS `getDay()` is Sunday-first, hence the `+ 6) % 7` rotation).
 */
export function monthCells(year: number, month: number): Array<Date | null> {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(new Date(year, month, d));
  return cells;
}
