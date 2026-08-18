import { nominalDayKey } from '@/lib/services/day-key';

/**
 * The earliest bookable transfer day = today + the activity's minimum advance-booking days.
 *
 * Mirrors the server floor exactly: create_hold raises `occurrence_too_soon` and
 * api_list_availability clamps its lower bound to `today + activities.min_advance_days` (default 1 —
 * no same-day, earliest is tomorrow). The transfer widget doesn't gate its date picker on the
 * availability map (unlike the catalogue booking flow), so it must apply this floor itself, or it
 * keeps offering days the server will refuse — the "customer can pick today" bug.
 *
 * `todayYmd` is the caller's LOCAL 'YYYY-MM-DD' (so server and client agree on which day is "today");
 * a malformed value is returned unchanged rather than throwing into render.
 */
export function earliestBookableDay(todayYmd: string, minAdvanceDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((todayYmd ?? '').trim());
  if (!m) return todayYmd;
  const days = Number.isFinite(minAdvanceDays) ? Math.max(0, Math.floor(minAdvanceDays)) : 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return nominalDayKey(d);
}

/**
 * True when a return/departure leg is dated strictly before the arrival leg. Both are 'YYYY-MM-DD',
 * which compares lexicographically the same as chronologically, so no Date parsing is needed. An
 * empty side is "not yet comparable" and never counts as invalid.
 */
export function returnBeforeArrival(arrivalYmd: string, returnYmd: string): boolean {
  return Boolean(arrivalYmd && returnYmd && returnYmd < arrivalYmd);
}
