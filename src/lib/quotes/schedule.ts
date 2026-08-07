/**
 * Rest-day scheduling for the AI email → draft quote flow (plan Task A3).
 *
 * A customer who asks for four excursions over a nine-day stay "with a rest day between each" is
 * describing a SPACING, not a list of dates. This spreads N excursions across a window, `gapDays`
 * apart, so the draft proposes day 1 / day 3 / day 5 rather than four tours on consecutive mornings.
 *
 * It is pure and best-effort. Nothing here reserves a seat or checks availability — the draft builder
 * verifies each proposed day against real open occurrences (`loadActivityDepartures`) and the operator
 * can move any date before sending. When the window is too small to hold every excursion at the chosen
 * gap it places as many as fit and REPORTS the shortfall (`truncated`), so the gap that could not be
 * honoured surfaces to the operator rather than silently collapsing tours onto one day.
 *
 * Dates are plain `yyyy-mm-dd` calendar days, stepped in UTC. Mauritius keeps a fixed +04:00 with no
 * DST, so a calendar-day step never drifts — the same reason the rest of the quotes code (state.ts's
 * `mauritiusInstant`) treats a Mauritius wall-clock day as an exact instant.
 */

export interface ProposedSchedule {
  /** One `yyyy-mm-dd` per placed excursion, ascending. Fewer than `requested` when `truncated`. */
  dates: string[];
  /** How many excursions were asked for. */
  requested: number;
  /** How many actually fit in the window (`dates.length`). */
  placed: number;
  /** True when the window could not hold every excursion at the requested gap. */
  truncated: boolean;
}

const MS_PER_DAY = 86_400_000;

/** Midnight UTC for a `yyyy-mm-dd`, or null if the input is not a valid calendar day. */
function utcDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Space `count` excursions `gapDays` apart within `[from, to]`.
 *
 * - `from` missing/invalid → nothing can be placed (`truncated` when any were requested).
 * - `to` missing/invalid → the window is treated as open-ended: every excursion is placed.
 * - `gapDays` is clamped to at least 1, so two excursions never share a day.
 * - `count` is floored to a non-negative whole number.
 */
export function proposeSchedule(
  from: string | null | undefined,
  to: string | null | undefined,
  count: number,
  gapDays: number,
): ProposedSchedule {
  const requested = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const gap = Math.max(1, Math.floor(Number.isFinite(gapDays) ? gapDays : 1));
  const start = utcDay(from);
  const end = utcDay(to);

  if (start === null) {
    // No anchor day, so nothing can be scheduled. Report truncation only if something was asked for.
    return { dates: [], requested, placed: 0, truncated: requested > 0 };
  }

  const dates: string[] = [];
  let cursor = start;
  for (let i = 0; i < requested; i += 1) {
    // A bounded window stops as soon as the next slot would fall past the return date. An unbounded
    // window (no valid `to`) places every requested excursion.
    if (end !== null && cursor > end) break;
    dates.push(isoDay(cursor));
    cursor += gap * MS_PER_DAY;
  }

  return {
    dates,
    requested,
    placed: dates.length,
    truncated: dates.length < requested,
  };
}
