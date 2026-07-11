import type { SupabaseClient } from '@supabase/supabase-js';
import type { ServiceContext } from '@/lib/services/context';
import type { DbRpc } from '@/lib/db/rpc';
import type { Database } from '@/lib/supabase/types';
import type { PaymentProvider } from '@/lib/payments/types';
import { createUserClient } from '@/lib/supabase/client';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { supabaseRpc } from '@/lib/supabase/rpc';
import { seedRpc } from '@/lib/dev/seed-rpc';
import { getServerEnv } from '@/lib/config/env';
import { getPaymentProvider } from '@/lib/payments';
import { getAiProvider } from '@/lib/ai';
import { getBearerToken } from './auth';

/**
 * Builds a ServiceContext with a LAZY payment provider: it is constructed on first access and
 * memoised. The public catalogue never takes a payment, so it must not construct the provider —
 * otherwise the fail-closed payment gate (refuses the stub on a real backend) would 500 an
 * unrelated read. Payment routes access `ctx.payments` and get the gate as intended.
 */
function makeContext(db: DbRpc, admin?: SupabaseClient<Database>): ServiceContext {
  let payments: PaymentProvider | null = null;
  return {
    db,
    get payments(): PaymentProvider {
      payments ??= getPaymentProvider();
      return payments;
    },
    ai: getAiProvider(),
    ...(admin ? { admin } : {}),
    now: () => new Date(),
  };
}

/**
 * Chooses the db transport. With Supabase configured it's the real client; otherwise it falls back to
 * the in-memory seed fixture so the public catalogue renders without a project — in dev, OR in a preview
 * build that opts in with ENABLE_PREVIEW_FALLBACK=true. (Hosted preview builds run NODE_ENV=production,
 * so the NODE_ENV check alone never reached them, contradicting the "preview" promise.) A real
 * production deploy with no Supabase still fails loudly (neither flag set).
 */
function selectDb(token: string | null): DbRpc {
  const env = getServerEnv();
  const configured = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const previewFallback =
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_PREVIEW_FALLBACK === 'true';
  if (!configured && previewFallback) {
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
  return makeContext(selectDb(getBearerToken(req)));
}

/**
 * User-scoped ServiceContext built from an already-verified access token (for Server Actions that hold
 * the token rather than the Request). RLS runs as that user — needed so a SECURITY DEFINER function's
 * `auth.uid()` self-guard (e.g. api_erase_user) sees the caller and not a NULL service-role subject.
 */
export function userServiceContext(token: string): ServiceContext {
  return makeContext(selectDb(token));
}

/** Anonymous context for public server components (RLS shows published only). */
export function publicServiceContext(): ServiceContext {
  return makeContext(selectDb(null));
}

/**
 * Trusted RPC context (service-role rpc port, NO raw admin handle). For public routes that must call a
 * hardened mutation RPC which is now revoked from anon/authenticated — the per-IP rate limiter, hold
 * creation, lead capture. Those RPCs are SECURITY DEFINER and identity-free, so running them as the
 * service role is behaviour-preserving; locking their grants stops a direct anon-key PostgREST call
 * from bypassing the route throttle. Falls back to the in-memory seed fixture in dev / preview builds
 * with no Supabase configured (mirrors selectDb), so local flows keep working without a service key.
 * Deliberately omits the raw admin client so a route can't accidentally issue arbitrary admin reads.
 */
export function serviceRoleRpcContext(): ServiceContext {
  const env = getServerEnv();
  const configured = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  const previewFallback =
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_PREVIEW_FALLBACK === 'true';
  if (!configured && previewFallback) {
    return makeContext(seedRpc());
  }
  return makeContext(supabaseRpc(createServiceRoleClient()));
}

/**
 * Service-role context for trusted internal workers (notification drain, hold sweep, payment
 * reconciliation). Bypasses RLS, so it must only be reached behind a server-side secret — never
 * from a user-facing route.
 */
export function serviceRoleServiceContext(): ServiceContext {
  // One service-role client backs both the rpc port (db) and the raw admin client the reconciliation
  // sweep needs to append settlement events across users.
  const admin = createServiceRoleClient();
  return makeContext(supabaseRpc(admin), admin);
}
