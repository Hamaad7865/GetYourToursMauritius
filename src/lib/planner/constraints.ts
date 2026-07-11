import {
  regionDistanceBand,
  REGION_DISTANCE_DEFAULT,
  type RegionDistanceMap,
} from '@/lib/services/pricing';

/**
 * Planner-day guardrails — the single source of truth for both the client and the AI co-pilot:
 *  1. a hard cap of {@link MAX_STOPS} stops, and
 *  2. region coherence: a stop may join the day only if its region is not `far` from EVERY region
 *     already chosen (all-pairs). The only `far` region pairs are North↔South and East↔West, so a
 *     South day still accepts East/West/Central but not North. We reuse `regionDistanceBand` /
 *     `REGION_DISTANCE_DEFAULT` rather than re-deriving distances.
 *
 * All-pairs (vs anchoring to one region) is deliberate: it only ever blocks on a `far` relationship,
 * yet also prevents an incoherent East+West spread built up via a Central/South hub.
 */
export const MAX_STOPS = 6;

/** True while the day still has room for another stop. */
export function canAddStop(count: number): boolean {
  return count < MAX_STOPS;
}

/**
 * A candidate region is compatible with the day iff it is not `far` from any region already present.
 * An empty day accepts anything. `regionDistanceBand` returns `far` for null inputs (fail-safe), so a
 * place whose region couldn't be classified is rejected rather than silently mixed in.
 */
export function isRegionCompatible(
  candidateRegion: string | null,
  dayRegions: Iterable<string | null>,
  distances: RegionDistanceMap = REGION_DISTANCE_DEFAULT,
): boolean {
  for (const region of dayRegions) {
    if (regionDistanceBand(candidateRegion, region, distances) === 'far') return false;
  }
  return true;
}

/** The day's headline region (most common, first-seen tie-break) — for copy only, never for gating. */
export function dayRegionLabel(dayRegions: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const region of dayRegions) {
    if (!region) continue;
    const next = (counts.get(region) ?? 0) + 1;
    counts.set(region, next);
    if (next > bestCount) {
      bestCount = next;
      best = region;
    }
  }
  return best;
}

/** Why a single candidate can't be added (null = it can). `full` takes precedence over `far-region`. */
export type AddBlockReason = 'full' | 'far-region' | null;

export function addBlockReason(
  candidateRegion: string | null,
  dayRegions: Array<string | null>,
  distances: RegionDistanceMap = REGION_DISTANCE_DEFAULT,
): AddBlockReason {
  if (!canAddStop(dayRegions.length)) return 'full';
  if (!isRegionCompatible(candidateRegion, dayRegions, distances)) return 'far-region';
  return null;
}

interface Regioned {
  id: string;
  region: string | null;
}

export interface FilterItineraryResult<T extends Regioned> {
  /** The committed day: items from `proposed` that passed the region rule and cap, in proposed order. */
  accepted: T[];
  /** Proposed items rejected because they were `far` from the day. */
  rejectedFarRegion: T[];
  /** Proposed items dropped because the day was already at {@link MAX_STOPS}. */
  droppedOverCap: T[];
}

/**
 * Server-side enforcement of a PROPOSED itinerary (the full ordered list the AI commits). The day's
 * existing regions seed the compatibility basis so a far stop is rejected even if the model dropped
 * the existing stops from its list — but existing items are NOT force-kept, so genuine removals and
 * reorders in `proposed` are honoured. If every proposed item is rejected, `accepted` is empty and the
 * caller keeps the current day unchanged (the co-pilot client only replaces the day on a non-empty
 * result), so a far-region request can never wipe the day.
 */
export function filterItinerary<T extends Regioned>(
  proposed: T[],
  existing: T[] = [],
  distances: RegionDistanceMap = REGION_DISTANCE_DEFAULT,
): FilterItineraryResult<T> {
  const accepted: T[] = [];
  const basisRegions: Array<string | null> = existing.map((e) => e.region);
  const seen = new Set<string>();
  const rejectedFarRegion: T[] = [];
  const droppedOverCap: T[] = [];

  for (const item of proposed) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (!isRegionCompatible(item.region, basisRegions, distances)) {
      rejectedFarRegion.push(item);
      continue;
    }
    if (accepted.length >= MAX_STOPS) {
      droppedOverCap.push(item);
      continue;
    }
    accepted.push(item);
    basisRegions.push(item.region);
  }

  return { accepted, rejectedFarRegion, droppedOverCap };
}
