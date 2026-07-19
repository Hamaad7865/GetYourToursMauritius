/**
 * Pure helpers for the planner's multi-day "trip" mode: a custom date range (e.g. Sep 1–5) where each
 * date gets its own planned day. Mirrors `share.ts` for the single-day flow — kept pure (no DOM, no
 * Date.now side effects beyond explicit args) so it unit-tests and runs on both server and client.
 *
 * URL shape (range mode): `?from=2026-09-01&to=2026-09-05&d0=<ids>&din0=<id>&act1=<slug>` — one `dN`
 * (ordered stop ids), optional `dinN` (dinner place id) and `actN` (a Belle Mare Tours activity slug)
 * per day index. Single-day links keep the long-standing `?stops=` form untouched.
 */

/** Hard cap on a trip's length. Each planned day costs billed Places/Gemini calls and its own tab, so
 *  the range picker clamps to a week; longer stays continue in chat or a second trip. */
export const MAX_TRIP_DAYS = 7;

/** A single planned day of the trip. `stopIds` is the ordered drive itinerary (lunch included);
 *  `dinnerId` is a suggestion near the pickup area (own marker, not part of the route);
 *  `activitySlug` anchors a recommended Belle Mare Tours activity to this date. */
export interface TripDayPlan {
  date: string;
  stopIds: string[];
  dinnerId: string | null;
  activitySlug: string | null;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Activity slugs are kebab-case route params; anything else in a hand-edited link is dropped. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const MS_PER_DAY = 86_400_000;

/** True for a well-formed calendar-day key (`YYYY-MM-DD`) that survives a UTC date round-trip
 *  (so `2026-02-31` is rejected, not silently rolled over). */
export function isDayKey(s: string | null | undefined): s is string {
  if (!s || !DAY_KEY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Day key + n days (UTC arithmetic on nominal keys — no timezone drift). */
export function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  return new Date(d.getTime() + n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (0 when equal; negative when reversed). */
export function daySpan(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / MS_PER_DAY,
  );
}

/**
 * The trip's dates, inclusive, in order. Reversed input is swapped (the picker never traps the
 * visitor), and the range is clamped to {@link MAX_TRIP_DAYS} from the start date. Malformed keys
 * yield `[]` so a hand-edited link degrades to single-day mode rather than NaN dates.
 */
export function tripDates(from: string, to: string): string[] {
  if (!isDayKey(from) || !isDayKey(to)) return [];
  let a = from;
  let b = to;
  if (daySpan(a, b) < 0) [a, b] = [b, a];
  const span = Math.min(daySpan(a, b), MAX_TRIP_DAYS - 1);
  const out: string[] = [];
  for (let i = 0; i <= span; i += 1) out.push(addDays(a, i));
  return out;
}

/** Serialize the trip into query params (mutates `params` in place, clearing stale day keys first).
 *  Empty days still hold their index (no `dN` param) so day order is positional and stable. */
export function tripToParams(params: URLSearchParams, days: TripDayPlan[]): void {
  // Clear every previous trip param (the day count may have shrunk).
  for (const key of [...params.keys()]) {
    if (/^(d|din|act)\d+$/.test(key)) params.delete(key);
  }
  if (!days.length) {
    params.delete('from');
    params.delete('to');
    return;
  }
  params.set('from', days[0]!.date);
  params.set('to', days[days.length - 1]!.date);
  days.forEach((day, i) => {
    if (day.stopIds.length) params.set(`d${i}`, day.stopIds.join(','));
    if (day.dinnerId) params.set(`din${i}`, day.dinnerId);
    if (day.activitySlug) params.set(`act${i}`, day.activitySlug);
  });
}

/** One raw id list from a `dN` param: trimmed, de-duplicated, capped (ids are live Google place ids,
 *  so existence is resolved later via the places endpoint — unknown ids simply drop there). */
function parseIdList(raw: string | null, cap: number): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id && id.length <= 256 && !seen.has(id) && out.length < cap) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Parse a shared trip link back into day plans. Returns `null` unless BOTH `from` and `to` are valid
 * day keys (single-day links have neither, and a mangled range shouldn't half-restore). Day params
 * beyond the derived date list are ignored; missing ones become empty days.
 */
export function parseTripParams(
  params: URLSearchParams,
  maxStopsPerDay: number,
): TripDayPlan[] | null {
  const from = params.get('from');
  const to = params.get('to');
  if (!isDayKey(from) || !isDayKey(to)) return null;
  const dates = tripDates(from, to);
  if (!dates.length) return null;
  return dates.map((date, i) => {
    const dinner = params.get(`din${i}`)?.trim() ?? '';
    const slug = params.get(`act${i}`)?.trim() ?? '';
    return {
      date,
      stopIds: parseIdList(params.get(`d${i}`), maxStopsPerDay),
      dinnerId: dinner && dinner.length <= 256 ? dinner : null,
      activitySlug: SLUG_RE.test(slug) ? slug : null,
    };
  });
}
