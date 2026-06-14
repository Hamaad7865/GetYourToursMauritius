import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { getServerEnv } from '@/lib/config/env';
import { ConfigError } from '@/lib/services/errors';

/**
 * Per-request, user-scoped Supabase client. Uses the public anon key and injects
 * the caller's access token so Row Level Security evaluates as that user
 * (`auth.uid()` resolves). Session persistence is disabled — the token is passed
 * explicitly, so the same flow works for web and mobile.
 *
 * IMPORTANT: build a fresh client per request. Never reuse one across requests on
 * the edge, or one user's token could leak to another.
 */
export function createUserClient(accessToken?: string | null): SupabaseClient<Database> {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new ConfigError('Supabase URL and anon key must be configured');
  }

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}
