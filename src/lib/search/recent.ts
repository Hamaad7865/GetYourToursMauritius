/* Recent search queries, persisted in localStorage (most-recent-first, deduped, capped). */

const KEY = 'gytm:recent-searches';
const MAX = 6;

export function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string): void {
  const q = query.trim();
  if (!q || typeof window === 'undefined') return;
  try {
    const next = [q, ...getRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(
      0,
      MAX,
    );
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
