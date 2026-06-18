import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import { createServiceRoleClient } from '@/lib/supabase/admin';

/**
 * Two-layer cache for Google Places responses, shared by the browse endpoint and the AI co-pilot so
 * identical searches + resolved place ids don't re-hit the billed Places API.
 *
 * L1 — in-memory (per server instance): instant, but lost on cold start / not shared across isolates.
 * L2 — durable + shared (Supabase `places_cache`, written with the service-role key): survives
 *      restarts and is shared across every instance + user, so at scale a place is fetched from Google
 *      roughly once per TTL for the whole platform.
 *
 * Both layers fail open: if Supabase/the table/the key isn't available it silently falls back to L1
 * (and to a live API call), so caching never breaks discovery.
 */
interface Entry<T> {
  value: T;
  expires: number;
}

const mem = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 500;

function memGet<T>(key: string): T | undefined {
  const e = mem.get(key);
  if (!e) return undefined;
  if (e.expires <= Date.now()) {
    mem.delete(key);
    return undefined;
  }
  mem.delete(key); // re-insert as most-recently-used (LRU)
  mem.set(key, e);
  return e.value as T;
}

function memSet<T>(key: string, value: T, expires: number): void {
  if (mem.size >= MAX_ENTRIES) {
    const oldest = mem.keys().next().value;
    if (oldest !== undefined) mem.delete(oldest);
  }
  mem.set(key, { value, expires });
}

// L2 durable client — lazy singleton; null when unconfigured or under tests (kept to L1 there).
let durable: SupabaseClient<Database> | null | undefined;
function durableClient(): SupabaseClient<Database> | null {
  if (durable !== undefined) return durable;
  if (process.env.VITEST) {
    durable = null;
    return null;
  }
  try {
    durable = createServiceRoleClient();
  } catch {
    durable = null;
  }
  return durable;
}

/** Returns the cached value if present and unexpired (L1 first, then the durable L2), else undefined. */
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const hit = memGet<T>(key);
  if (hit !== undefined) return hit;

  const db = durableClient();
  if (!db) return undefined;
  try {
    const { data } = await db.from('places_cache').select('data, expires_at').eq('key', key).maybeSingle();
    if (data) {
      const expires = new Date(data.expires_at).getTime();
      if (expires > Date.now()) {
        memSet(key, data.data as unknown as T, expires); // warm L1 from L2
        return data.data as unknown as T;
      }
    }
  } catch {
    /* L2 unavailable (table missing, network) — fall through to a live fetch */
  }
  return undefined;
}

/** Stores a value in both layers with a TTL. The durable write is best-effort. */
export async function cacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const expiresAt = Date.now() + ttlMs;
  memSet(key, value, expiresAt);

  const db = durableClient();
  if (!db) return;
  try {
    await db
      .from('places_cache')
      .upsert({ key, data: value as unknown as Json, expires_at: new Date(expiresAt).toISOString() });
  } catch {
    /* L2 unavailable — L1 still holds it */
  }
}

/** Test helper — empties the in-memory layer. */
export function clearPlacesCache(): void {
  mem.clear();
}
