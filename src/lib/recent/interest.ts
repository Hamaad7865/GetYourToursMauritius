/* The guides a visitor has read, each with the tours that guide recommends, persisted in localStorage
 * (most-recent-first, deduped by guide, capped). Written by <RecordInterest> on attraction pages, blog
 * posts with their own tour list and the three topic pages; read by the homepage's first row
 * (chooseHomeRow). Device-local only, like recent views — nothing here is sent to the server, and the
 * "Clear" buttons on the homepage remove it. No 'use client': the pre-paint script reads the key. */

export const INTEREST_KEY = 'gytm:interest';
/** Same-tab change signal (storage events only fire in *other* tabs). */
export const INTEREST_EVENT = 'gytm:interest';
const MAX_TOPICS = 5;
const MAX_SLUGS = 6;

export interface Interest {
  /** One per guide: `attraction:<id>`, `post:<slug>` or `hub:<path>`. */
  topic: string;
  /** The tours that guide shows, in its order. */
  slugs: string[];
}

function isInterest(value: unknown): value is Interest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.topic === 'string' &&
    Array.isArray(v.slugs) &&
    v.slugs.every((s) => typeof s === 'string')
  );
}

export function readInterest(): Interest[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INTEREST_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isInterest) : [];
  } catch {
    return [];
  }
}

export function recordInterest(topic: string, slugs: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const kept = [...new Set(slugs)].slice(0, MAX_SLUGS);
  if (!topic || kept.length === 0) return;
  try {
    const next = [{ topic, slugs: kept }, ...readInterest().filter((i) => i.topic !== topic)].slice(
      0,
      MAX_TOPICS,
    );
    window.localStorage.setItem(INTEREST_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(INTEREST_EVENT));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function clearInterest(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(INTEREST_KEY);
    window.dispatchEvent(new Event(INTEREST_EVENT));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
