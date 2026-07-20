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
 * Deliberately stricter than the booking calendar's `seatsLeft > 0`: a reschedule carries the WHOLE
 * party across, so a 4-guest booking must not be offered a date with 2 seats left — the server would
 * reject it with insufficient_capacity and the guest would just hit a wall. Option is filtered here
 * too; `api_reschedule_booking` enforces it as well (same option = same price), but offering a date
 * that is guaranteed to fail is its own bug.
 */
export function pickRescheduleDates(
  slots: readonly AvailabilitySlot[],
  opts: {
    activityOptionId: string | null | undefined;
    partySize: number;
    excludeOccurrenceId?: string | null;
    limit?: number;
  },
): RescheduleDate[] {
  const { activityOptionId, partySize, excludeOccurrenceId, limit } = opts;
  if (!activityOptionId) return [];
  // A booking with no recorded headcount still needs at least one seat to land on.
  const needed = Number.isFinite(partySize) && partySize > 0 ? partySize : 1;

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
