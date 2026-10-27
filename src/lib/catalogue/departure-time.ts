/**
 * A tour's departure time, as "HH:MM".
 *
 * Every catalogue day-slot is materialised at a placeholder clock time (`materialize_availability`
 * puts it at noon Mauritius; slots made before the July timezone fix sit at 16:00), because the guest
 * books a DAY, not a time. So a slot's `starts_at` clock is never a departure. The real one is the start
 * time staff type on the activity (Logistics → "Start time / departure", `extra.startWindow`) or on one
 * of its options (`activity_options.start_window`, e.g. a Half day leaving earlier than a Full day).
 * One departure can also leave at its own time, set from the calendar (`session_occurrences.
 * departure_time`), which wins over both — see {@link occurrenceDepartureTime}.
 *
 * That field is free text shown verbatim in the public "at a glance" facts — "09:00", "07 00",
 * "09:00 - 17:00" — so every booking surface reads it through here: the dashboard, the bookings list,
 * the calendar, the quote builder, and the guest's confirmation email + invoice. Text with no
 * recognisable leading time gives null, and the surface shows the date alone rather than a guess.
 */

/** "09:00", "9:00", "07 00", "7.30", "07h30", "9am", "2:30 pm" — read from the start of the text, so
 *  a range like "09:00 - 17:00" departs at its first time. */
const CLOCK = /^\s*(\d{1,2})\s*(?:[:.hH]|\s)\s*(\d{2})(?!\d)(?:\s*([ap])\.?\s*m\b)?/i;
/** "9am", "2 pm" — an hour with a meridiem and no minutes. */
const HOUR_MERIDIEM = /^\s*(\d{1,2})\s*([ap])\.?\s*m\b/i;

/** The departure clock time at the start of a free-text start window, or null when there is none. */
export function departureClock(text: string | null | undefined): string | null {
  if (!text) return null;
  const clock = CLOCK.exec(text);
  const bare = clock ? null : HOUR_MERIDIEM.exec(text);
  const match = clock ?? bare;
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = clock ? Number(clock[2]) : 0;
  const meridiem = (clock ? clock[3] : bare![2])?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'p' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * The departure time of a booking on one option: the option's own start time when it has one, else the
 * activity's. The option's text wins outright even when it is not a time ("Flexible"), the same
 * precedence the public "at a glance" facts use, so the booking never claims a time the page does not.
 */
export function tourDepartureTime(
  optionStartWindow: string | null | undefined,
  activityStartWindow: string | null | undefined,
): string | null {
  return departureClock(optionStartWindow?.trim() || activityStartWindow?.trim() || null);
}

/**
 * The departure time of one departure: the time staff set for it on the calendar
 * (`session_occurrences.departure_time`, which Postgres returns as "HH:MM:SS"), else its tour's start
 * time ({@link tourDepartureTime}). Every surface that prints a booked departure's time reads this.
 */
export function occurrenceDepartureTime(
  override: string | null | undefined,
  optionStartWindow: string | null | undefined,
  activityStartWindow: string | null | undefined,
): string | null {
  return departureClock(override) ?? tourDepartureTime(optionStartWindow, activityStartWindow);
}
