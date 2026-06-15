import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Browser-side Supabase client (anon key + the signed-in user's session). Unlike the
 * server `createUserClient`, this one PERSISTS the session in localStorage and refreshes
 * tokens, so a sign-in survives reloads. It talks to Supabase directly under RLS for the
 * authenticated account pages; our `/api/v1` (Bearer) layer remains the path for mobile.
 *
 * A single instance is reused across client components (Supabase warns on duplicates).
 */
let client: SupabaseClient<Database> | null = null;

export function getBrowserSupabase(): SupabaseClient<Database> {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase browser client is not configured (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY).');
  }
  client = createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'gytm:auth',
    },
  });
  return client;
}
