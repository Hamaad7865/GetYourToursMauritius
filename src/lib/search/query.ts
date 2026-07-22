/** Shared search helpers used by the desktop SearchBar and the mobile search sheet, so they build
 *  the same /activities URL and do the same calendar math. */

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function sameDay(a: Date | null, b: Date | null): boolean {
  return !!a && !!b && a.toDateString() === b.toDateString();
}

/**
 * The chosen calendar date as a LOCAL YYYY-MM-DD string. We use the local date components (not
 * toISOString) so "20 June" stays 20 June regardless of the browser timezone — a tour date is a
 * calendar day, not an instant.
 */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthCells(year: number, month: number): Array<Date | null> {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Sun(0) → 6
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(new Date(year, month, d));
  return cells;
}

export interface SearchValue {
  query: string;
  date: Date | null;
  adults: number;
  kids: number;
}

/** Build the /activities URL for a search. Pure — the caller records the recent search. */
export function buildSearchUrl({ query, date, adults, kids }: SearchValue): string {
  const params = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed) params.set('q', trimmed);
  if (date) params.set('date', toIso(date));
  if (adults !== 1) params.set('adults', String(adults));
  if (kids > 0) params.set('children', String(kids));
  const qs = params.toString();
  return `/activities${qs ? `?${qs}` : ''}`;
}

/**
 * Just the adults/children fragment (no leading `?`, no `q`/`date`) — for carrying the header
 * search's traveller count onward from an autocomplete pick or a browse-results card link to a
 * specific activity's detail page, where BookingProvider reads it back out (mirrors the ?date=
 * deep-link convention). Omits defaults (1 adult, 0 children) exactly like buildSearchUrl.
 */
export function travellersQueryParams(adults?: number, kids?: number): string {
  const params = new URLSearchParams();
  if (adults != null && adults !== 1) params.set('adults', String(adults));
  if (kids != null && kids > 0) params.set('children', String(kids));
  return params.toString();
}

/** Appends travellersQueryParams onto a path that has no query string of its own yet. */
export function withTravellers(path: string, adults?: number, kids?: number): string {
  const qs = travellersQueryParams(adults, kids);
  return qs ? `${path}?${qs}` : path;
}
