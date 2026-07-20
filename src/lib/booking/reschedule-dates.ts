import { nominalDayKey } from '@/lib/services/day-key';

/** One slot as returned by GET /api/v1/activities/:slug/availability. */
export interface AvailabilitySlot {
  occurrenceId: string;
  activityOptionId: string;
  startsAt: string;
  seatsLeft: number;
  status?: string | null;
}

export interface RescheduleDate {
  occurrenceId: string;
  startsAt: string;
  seatsLeft: number;
}

/** How far ahead we offer replacement dates. Matches the booking widget's horizon. */
export const RESCHEDULE_HORIZON_DAYS = 180;

/** How many dates the banner shows before "show more". */
export const RESCHEDULE_PAGE_SIZE = 8;

/**
 * The dates a booking may actually move to.
 *
 * `unitsNeeded` is the BOOKING-UNIT count (sum of `quantity`), NOT the headcount — the same unit
 * `seatsLeft` is denominated in. For a per-person option the two coincide; for a vehicle or private
 * option `quantity` is 1 (one van, one trip, any group size) while the headcount is in `pax`.
 * Filtering a 6-guest transfer on its headcount would hide every date with fewer than 6 vans free,
 * including the empty ones — and the sale that created the booking only ever consumed one van.
 *
 * Still stricter than the booking calendar's `seatsLeft > 0`, because a reschedule carries the whole
 * booking across: offering a date the server will reject with insufficient_capacity is its own bug.
 */
export function pickRescheduleDates(
  slots: readonly AvailabilitySlot[],
  opts: {
    activityOptionId: string | null | undefined;
    unitsNeeded: number;
    excludeOccurrenceId?: string | null;
    limit?: number;
  },
): RescheduleDate[] {
  const { activityOptionId, unitsNeeded, excludeOccurrenceId, limit } = opts;
  if (!activityOptionId) return [];
  // A booking with no recorded units still needs somewhere to land.
  const needed = Number.isFinite(unitsNeeded) && unitsNeeded > 0 ? unitsNeeded : 1;

  const seen = new Set<string>();
  const out: RescheduleDate[] = [];
  for (const s of [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    if (s.activityOptionId !== activityOptionId) continue;
    if (excludeOccurrenceId && s.occurrenceId === excludeOccurrenceId) continue;
    if (s.status && s.status !== 'open') continue;
    if (s.seatsLeft < needed) continue;
    // One entry per calendar day — two departures on one day would read as a duplicate date.
    const key = s.startsAt.slice(0, 10);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ occurrenceId: s.occurrenceId, startsAt: s.startsAt, seatsLeft: s.seatsLeft });
    if (limit != null && out.length >= limit) break;
  }
  return out;
}

/** The availability URL for a booking's replacement dates, from today to the horizon. */
export function rescheduleAvailabilityUrl(slug: string, from: Date): string {
  const to = new Date(from);
  to.setDate(to.getDate() + RESCHEDULE_HORIZON_DAYS);
  return `/api/v1/activities/${encodeURIComponent(slug)}/availability?from=${nominalDayKey(from)}&to=${nominalDayKey(to)}`;
}

/**
 * True when we called this booking's departure off and the guest has not yet chosen.
 * Mirrors the SQL predicate that unlocks the 24h-window bypass, so the UI and the server agree.
 */
export function isAwaitingDisruptionChoice(
  disruption: { resolvedAt?: string | null } | null | undefined,
): boolean {
  return disruption != null && disruption.resolvedAt == null;
}
