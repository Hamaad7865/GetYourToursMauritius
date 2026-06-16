import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { getServerEnv } from '@/lib/config/env';
import { getPaymentProvider } from '@/lib/payments';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { searchToursQuerySchema } from '@/lib/validation/tours';

export const runtime = 'edge';

/** Lightweight DB reachability probe (anon read). */
async function pingDatabase(): Promise<boolean> {
  try {
    const ctx = publicServiceContext();
    await searchActivities(ctx, searchToursQuerySchema.parse({ pageSize: 1 }));
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /api/v1/health — liveness/readiness for uptime monitors and post-deploy checks. Shallow by
 * default (config + safety only, no DB); `?deep=true` also pings the database. In a LIVE
 * environment, missing config or an unsafe payment provider make it 503 so a misconfigured deploy
 * is caught; outside live, the stub is acceptable and it reports 200.
 */
export const GET = apiHandler(async (req) => {
  const env = getServerEnv();
  const isLive = env.PEACH_ENVIRONMENT === 'live';
  const checks: Record<string, boolean> = {};

  checks.supabaseConfigured = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  checks.serviceRoleConfigured = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

  // The payment provider must never be the unauthenticated stub in a live environment.
  try {
    checks.paymentsSafe = !isLive || getPaymentProvider().name !== 'stub';
  } catch {
    checks.paymentsSafe = false; // misconfigured (e.g. live with no Peach keys)
  }
  // The legacy HS256 forgery path must be off in live.
  checks.legacyAuthDisabled = !isLive || !env.ACCEPT_LEGACY_HS256;

  const deep = new URL(req.url).searchParams.get('deep') === 'true';
  if (deep) checks.database = await pingDatabase();

  // Outside a live environment, only the safety checks gate health (config may be partial in dev).
  const gates = isLive
    ? [checks.supabaseConfigured, checks.serviceRoleConfigured, checks.paymentsSafe, checks.legacyAuthDisabled]
    : [checks.paymentsSafe, checks.legacyAuthDisabled];
  const healthy = gates.every(Boolean) && (deep ? checks.database : true);

  const body = { status: healthy ? 'ok' : 'degraded', live: isLive, checks, time: new Date().toISOString() };
  return healthy
    ? jsonOk(body, { headers: { 'Cache-Control': 'no-store' } })
    : jsonError(503, 'unhealthy', 'One or more health checks failed', body, { 'Cache-Control': 'no-store' });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
