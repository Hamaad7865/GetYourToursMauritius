/**
 * Tiny in-memory TTL cache for Google Places responses — shared by both the browse endpoint and the
 * AI co-pilot (they both go through google-places.ts), so identical searches + already-resolved place
 * ids don't re-hit the billed Places API. Module-scoped: hot within a warm server instance (and very
 * effective in dev / on a long-lived Node server). The endpoint also sets an edge HTTP cache, and a
 * durable shared store (Supabase/KV) can be layered behind this later for cross-instance reuse.
 */
interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 500;

/** Returns the cached value if present and unexpired (and marks it most-recently-used), else undefined. */
export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (e.expires <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  // Touch for LRU: re-insert so it becomes the newest entry.
  store.delete(key);
  store.set(key, e);
  return e.value as T;
}

/** Stores a value with a TTL, evicting the oldest entry when full. */
export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expires: Date.now() + ttlMs });
}

/** Test helper — empties the cache. */
export function clearPlacesCache(): void {
  store.clear();
}
