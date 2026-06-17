function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Calendar-day key 'YYYY-MM-DD' from the LOCAL components of a Date. Use for calendar-grid cells
 *  and fetch-range bounds, which are nominal year/month/day with no real timezone attached. */
export function nominalDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar-day key 'YYYY-MM-DD' from the UTC components of a Date. Open-ended availability slots are
 *  materialized at NOON UTC and the DB de-dupes one slot per option per UTC day, so a slot's calendar
 *  day MUST be read in UTC — otherwise a far-east (UTC+12..+14) user sees each slot shifted onto the
 *  next day. Use for any startsAt coming back from the availability API. */
export function utcDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
