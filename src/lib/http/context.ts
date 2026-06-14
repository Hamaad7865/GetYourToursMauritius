import type { ServiceContext } from '@/lib/services/context';
import { createUserClient } from '@/lib/supabase/client';
import { supabaseRpc } from '@/lib/supabase/rpc';
import { getPaymentProvider } from '@/lib/payments';
import { getAiProvider } from '@/lib/ai';
import { getBearerToken } from './auth';

/**
 * Builds a per-request ServiceContext. The db is a user-scoped rpc client (RLS as
 * the caller via the Bearer token, or anonymous when absent). Routes should call
 * `authenticateOptional`/`requireUser` first so an invalid token is rejected before
 * this runs.
 */
export function buildServiceContext(req: Request): ServiceContext {
  const token = getBearerToken(req);
  return {
    db: supabaseRpc(createUserClient(token)),
    payments: getPaymentProvider(),
    ai: getAiProvider(),
    now: () => new Date(),
  };
}

/** Anonymous context for public server components (RLS shows published only). */
export function publicServiceContext(): ServiceContext {
  return {
    db: supabaseRpc(createUserClient(null)),
    payments: getPaymentProvider(),
    ai: getAiProvider(),
    now: () => new Date(),
  };
}
