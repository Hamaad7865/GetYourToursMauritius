import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { getServerEnv } from '@/lib/config/env';
import { ConfigError } from '@/lib/services/errors';
import { timeoutFetch, DEFAULT_UPSTREAM_TIMEOUT_MS } from '@/lib/http/timeout-fetch';

/**
 * Service-role Supabase client. SERVER ONLY — bypasses Row Level Security.
 *
 * Use only for trusted operations that arrive without a user JWT (the Peach
 * webhook) or that legitimately need to act across users (admin tooling).
 * ESLint forbids importing this from the service layer; pass the resulting client
 * in via ServiceContext instead.
 *
 * `timeoutMs` overrides the per-call upstream timeout. The error-log sink passes a much shorter one:
 * it runs while a request is already failing, so a sick database must not add the full default wait
 * to a response the customer is waiting on.
 */
export function createServiceRoleClient(
  timeoutMs: number = DEFAULT_UPSTREAM_TIMEOUT_MS,
): SupabaseClient<Database> {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ConfigError('Supabase URL and service-role key must be configured');
  }

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    // Timeout every DB call so a slow/unreachable Supabase fails fast as a clean error instead of
    // hanging the edge worker into a Cloudflare 502.
    global: { fetch: timeoutFetch(timeoutMs) },
  });
}
