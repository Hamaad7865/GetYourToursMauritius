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

/** True when the guest answered a call-off by moving to another date (not by taking the refund). */
export function wasRescheduled(
  disruption: { resolvedAt?: string | null; resolution?: string | null } | null | undefined,
): boolean {
  return disruption?.resolvedAt != null && disruption.resolution === 'rescheduled';
}

/** What POST /api/v1/bookings/:ref/reschedule answers with (`data` of the envelope). */
export interface RescheduleResponse {
  startsAt?: string | null;
  previousStartsAt?: string | null;
  alreadyOnDate?: boolean;
}

/**
 * What the guest is told the moment a move lands. `moved` names the new date (and the old one when
 * the server knew it); `same` is the idempotent replay, where the booking was already on that date and
 * nothing changed — telling them "moved" there would be untrue.
 *
 * The server's `startsAt` wins. `picked` (the slot the guest tapped) only fills in for the replay,
 * whose answer carries no date at all. Null when neither gives a real date, so the screen never
 * announces a date it cannot back up.
 */
export type RescheduleOutcome =
  | { kind: 'moved'; to: string; from: string | null }
  | { kind: 'same'; to: string };

export function rescheduleOutcome(
  response: RescheduleResponse | null | undefined,
  picked?: string | null,
): RescheduleOutcome | null {
  const to = response?.startsAt ?? picked ?? null;
  if (!to || Number.isNaN(new Date(to).getTime())) return null;
  if (response?.alreadyOnDate) return { kind: 'same', to };
  return { kind: 'moved', to, from: response?.previousStartsAt ?? null };
}
