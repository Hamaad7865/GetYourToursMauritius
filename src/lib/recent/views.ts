/* Recently viewed activity slugs, persisted in localStorage (most-recent-first, deduped, capped).
 * Written by <RecordView> on every activity page and read by the homepage's "Continue planning your
 * trip" rail. Device-local only — nothing here is sent to the server, which is also why the homepage
 * (edge-cached, identical for everyone) can only personalise in the browser. */

export const RECENT_VIEWS_KEY = 'gytm:recent';
/** Same-tab change signal (storage events only fire in *other* tabs). */
export const RECENT_VIEWS_EVENT = 'gytm:recent';
const MAX = 12;

export function readRecentViews(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_VIEWS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function recordRecentView(slug: string): void {
  if (typeof window === 'undefined') return;
  try {
    const next = [slug, ...readRecentViews().filter((s) => s !== slug)].slice(0, MAX);
    window.localStorage.setItem(RECENT_VIEWS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(RECENT_VIEWS_EVENT));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function clearRecentViews(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(RECENT_VIEWS_KEY);
    window.dispatchEvent(new Event(RECENT_VIEWS_EVENT));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
