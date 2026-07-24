import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Where the "Keep me signed in" choice is recorded. Absent (the default) means REMEMBER —
 * that is the behaviour every account had before the checkbox existed, so adding it never
 * signs anyone out. Only the opt-out is stored, as the string '0'.
 *
 * This lives in localStorage on purpose: it has to outlive the browser session it is opting
 * out of, so the checkbox comes back unticked on the next visit. It is a first-party
 * functional preference, not a tracker — same category as the session itself.
 */
const REMEMBER_KEY = 'gytm:auth:remember';

/** localStorage/sessionStorage, or null when unavailable (SSR, or blocked in private mode). */
function store(kind: 'local' | 'session'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Whether the session should survive closing the browser. Defaults to true. */
export function getAuthPersistence(): boolean {
  try {
    return store('local')?.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Record the "Keep me signed in" choice. MUST be called before the sign-in call, because the
 * storage adapter below reads it at write time — including on the OAuth round-trip, where the
 * PKCE verifier is written on the way out and read on the way back at `/auth/callback`.
 *
 * No existing session is migrated between stores: the flag can only be changed from the auth
 * dialog, which is only reachable while signed out.
 */
export function setAuthPersistence(remember: boolean): void {
  try {
    if (remember) store('local')?.removeItem(REMEMBER_KEY);
    else store('local')?.setItem(REMEMBER_KEY, '0');
  } catch {
    // Private mode with storage blocked: nothing persists anyway, so the choice is moot.
  }
}

function stores(): { active: Storage | null; other: Storage | null } {
  const remember = getAuthPersistence();
  return {
    active: store(remember ? 'local' : 'session'),
    other: store(remember ? 'session' : 'local'),
  };
}

/**
 * Session storage that honours "Keep me signed in": localStorage when remembering,
 * sessionStorage when not — the latter dies with the tab, which is the whole point on a
 * shared or hotel computer. sessionStorage does survive a same-tab redirect, so OAuth still
 * completes. The flag is read per call, so the shared client instance never has to be rebuilt.
 *
 * Exported for `tests/unit/auth-persistence.test.ts` — "no session left in localStorage" is the
 * security promise of the checkbox, so it is asserted directly rather than through the client.
 */
export const rememberAwareStorage = {
  getItem(key: string): string | null {
    const { active, other } = stores();
    try {
      // Fall back to the other store so flipping the flag without completing a sign-in
      // (e.g. unticking the box, then a failed submit) can't strand an existing session.
      return active?.getItem(key) ?? other?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    const { active, other } = stores();
    try {
      active?.setItem(key, value);
      // Never leave a copy behind in the store we are not using, or a "don't remember me"
      // sign-in would still be recoverable from localStorage after the browser closes.
      other?.removeItem(key);
    } catch {
      // Storage blocked — the session simply stays in memory for this page load.
    }
  },
  removeItem(key: string): void {
    try {
      store('local')?.removeItem(key);
      store('session')?.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  },
};

/**
 * Browser-side Supabase client (anon key + the signed-in user's session). Unlike the
 * server `createUserClient`, this one PERSISTS the session and refreshes tokens, so a sign-in
 * survives reloads. Where it persists depends on "Keep me signed in" — see
 * `rememberAwareStorage`. It talks to Supabase directly under RLS for the authenticated
 * account pages; our `/api/v1` (Bearer) layer remains the path for mobile.
 *
 * A single instance is reused across client components (Supabase warns on duplicates).
 */
let client: SupabaseClient<Database> | null = null;

export function getBrowserSupabase(): SupabaseClient<Database> {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase browser client is not configured (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY).',
    );
  }
  client = createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'gytm:auth',
      storage: rememberAwareStorage,
    },
  });
  return client;
}
