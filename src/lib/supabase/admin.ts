import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { getServerEnv } from '@/lib/config/env';
import { ConfigError } from '@/lib/services/errors';

/**
 * Service-role Supabase client. SERVER ONLY — bypasses Row Level Security.
 *
 * Use only for trusted operations that arrive without a user JWT (the Peach
 * webhook) or that legitimately need to act across users (admin tooling).
 * ESLint forbids importing this from the service layer; pass the resulting client
 * in via ServiceContext instead.
 */
export function createServiceRoleClient(): SupabaseClient<Database> {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ConfigError('Supabase URL and service-role key must be configured');
  }

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
