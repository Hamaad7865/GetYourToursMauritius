import type { ServiceContext } from '@/lib/services/context';
import type { DbRpc } from '@/lib/db/rpc';
import { createUserClient } from '@/lib/supabase/client';
import { supabaseRpc } from '@/lib/supabase/rpc';
import { seedRpc } from '@/lib/dev/seed-rpc';
import { getServerEnv } from '@/lib/config/env';
import { getPaymentProvider } from '@/lib/payments';
import { getAiProvider } from '@/lib/ai';
import { getBearerToken } from './auth';

/**
 * Chooses the db transport. With Supabase configured it's the real client; otherwise,
 * in dev/preview only, it falls back to the in-memory seed fixture so the public
 * catalogue renders without a project. Production with no Supabase still fails loudly.
 */
function selectDb(token: string | null): DbRpc {
  const env = getServerEnv();
  const configured = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!configured && process.env.NODE_ENV !== 'production') {
    return seedRpc();
  }
  return supabaseRpc(createUserClient(token));
}

/**
 * Builds a per-request ServiceContext. The db is a user-scoped rpc client (RLS as
 * the caller via the Bearer token, or anonymous when absent). Routes should call
 * `authenticateOptional`/`requireUser` first so an invalid token is rejected before
 * this runs.
 */
export function buildServiceContext(req: Request): ServiceContext {
  const token = getBearerToken(req);
  return {
    db: selectDb(token),
    payments: getPaymentProvider(),
    ai: getAiProvider(),
    now: () => new Date(),
  };
}

/** Anonymous context for public server components (RLS shows published only). */
export function publicServiceContext(): ServiceContext {
  return {
    db: selectDb(null),
    payments: getPaymentProvider(),
    ai: getAiProvider(),
    now: () => new Date(),
  };
}
