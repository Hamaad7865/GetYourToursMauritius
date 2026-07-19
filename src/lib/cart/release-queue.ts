/** Durable retry queue for hold releases (review item 5, client half).
 *
 *  `releaseHoldRequest` reports whether a release actually worked, but the cart's callers used to fire
 *  it with `void` and drop the hold id in the same breath — so a release that failed (offline, 5xx, a
 *  tab closed mid-request) left the seat reserved for the FULL 30-minute TTL with nothing tracking it.
 *  Every held line the customer resizes or removes could strand capacity that way.
 *
 *  The fix is a small write-AHEAD queue in localStorage: the hold id is recorded BEFORE the request
 *  goes out (a tab closing mid-request is exactly the case the retry exists for — a write in the
 *  `.then()` would never run), and removed once the release succeeds or fails permanently. The cart's
 *  existing 15-second tick drains whatever is left.
 *
 *  The helpers below are pure so the eviction rules are testable without a DOM; the read/write
 *  wrappers are the only part that touches storage.
 */

const KEY = 'gytm:release-queue';

/** A hold's server TTL. Past this the hold has expired on its own, so releasing it is pointless —
 *  entries older than this are pruned rather than retried against a seat that is already free. */
const HOLD_TTL_MS = 30 * 60 * 1000;

/** Cap the attempts per entry. The tick is 15s and the TTL 30 minutes, so without a cap a hold the
 *  server keeps 5xx-ing would be hammered ~120 times. Anything still failing after this is left to
 *  the hold-expiry + maintenance sweep. */
export const MAX_RELEASE_ATTEMPTS = 8;

export interface ReleaseEntry {
  holdId: string;
  /** ms epoch when the release was first attempted — drives the TTL prune. */
  queuedAt: number;
  /** How many times a release has been attempted for this hold. */
  attempts: number;
}

/** Record a hold as needing release (write-ahead). Re-queuing a hold already present keeps its
 *  original `queuedAt` (the TTL runs from the FIRST attempt, not the latest) and bumps `attempts`. */
export function addEntry(list: ReleaseEntry[], holdId: string, now: number): ReleaseEntry[] {
  const existing = list.find((e) => e.holdId === holdId);
  if (existing) {
    return list.map((e) => (e.holdId === holdId ? { ...e, attempts: e.attempts + 1 } : e));
  }
  return [...list, { holdId, queuedAt: now, attempts: 1 }];
}

/** Drop a hold from the queue — released, or permanently un-releasable by this caller. */
export function dropEntry(list: ReleaseEntry[], holdId: string): ReleaseEntry[] {
  return list.filter((e) => e.holdId !== holdId);
}

/** Entries worth another attempt: still inside the hold's TTL and under the attempt cap. Anything
 *  else is dropped — the seat is either already free (TTL lapsed) or beyond our help. */
export function pruneEntries(list: ReleaseEntry[], now: number): ReleaseEntry[] {
  return list.filter(
    (e) =>
      Number.isFinite(e.queuedAt) &&
      now - e.queuedAt < HOLD_TTL_MS &&
      e.attempts < MAX_RELEASE_ATTEMPTS,
  );
}

export function readReleaseQueue(): ReleaseEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    // Defensive: a hand-edited / half-written entry must not poison the drain loop.
    return (parsed as ReleaseEntry[]).filter(
      (e) => e && typeof e.holdId === 'string' && e.holdId.length > 0,
    );
  } catch {
    return [];
  }
}

export function writeReleaseQueue(list: ReleaseEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full / disabled — the release still fires, it just isn't retried */
  }
}

/** Write-ahead: record the hold BEFORE its release request goes out. */
export function queueRelease(holdId: string, now: number = Date.now()): void {
  writeReleaseQueue(addEntry(readReleaseQueue(), holdId, now));
}

/** Settle a hold: released, or permanently rejected — either way it leaves the queue. */
export function unqueueRelease(holdId: string): void {
  writeReleaseQueue(dropEntry(readReleaseQueue(), holdId));
}
