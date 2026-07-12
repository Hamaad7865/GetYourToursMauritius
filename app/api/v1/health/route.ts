import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive, isProductionLikeRuntime } from '@/lib/config/runtime';
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
  // The strict readiness gates key on the canonical production-like signal, NOT on PEACH_ENVIRONMENT
  // (whose schema default 'test' means a genuine production deploy that never set it — or ran a soft
  // launch in Peach test mode — would skip the Supabase / service-role / legacy-auth gates and report a
  // false 200). isProductionLikeRuntime fires on NODE_ENV=production OR a configured service-role key OR
  // an explicit Peach live, so it catches those deploys.
  const isProd = isProductionLikeRuntime(env);
  const checks: Record<string, boolean> = {};

  checks.supabaseConfigured = Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  checks.serviceRoleConfigured = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

  // NEXT_PUBLIC_SITE_URL defaults to localhost; if a production-like deploy ships with it
  // unset/localhost, customer return URLs, the Peach Origin, canonicals/OG/sitemap all point at
  // localhost. Surface it as a hard 503 so a misconfigured deploy is caught immediately. Keyed on
  // isProductionLikeRuntime (via the shared helper), so it fires even when PEACH_ENVIRONMENT=test.
  checks.siteUrlConfigured = isSiteUrlConfiguredForLive(env);

  // The payment provider must never be the unauthenticated stub on a production-like deploy (the
  // provider factory already fails closed there, so getPaymentProvider() throws → caught below).
  try {
    checks.paymentsSafe = !isProd || getPaymentProvider().name !== 'stub';
  } catch {
    checks.paymentsSafe = false; // misconfigured (e.g. production with no Peach keys)
  }
  // The legacy HS256 forgery path must be off on any production-like deploy.
  checks.legacyAuthDisabled = !isProd || !env.ACCEPT_LEGACY_HS256;

  // emailConfigured is reported, not gating: email is a feature (a partially-configured deploy still
  // reads "ok"). internalTasksConfigured (the INTERNAL_TASK_SECRET the cron authenticates with) IS
  // gating on a production-like deploy — without it the cron can't drain the outbox OR expire holds, so
  // confirmations never send and abandoned holds pin capacity forever. That's a broken deploy, not a
  // missing feature, so it must fail readiness rather than silently look healthy.
  checks.emailConfigured = Boolean(env.RESEND_API_KEY && env.RESEND_FROM);
  checks.internalTasksConfigured = Boolean(env.INTERNAL_TASK_SECRET);

  const deep = new URL(req.url).searchParams.get('deep') === 'true';
  if (deep) checks.database = await pingDatabase();

  // Outside a production-like runtime, only the safety checks gate health (config may be partial in
  // dev/CI). siteUrlConfigured gates in both branches: it is true unless the runtime is production-like
  // with a localhost/unset site URL, so it never fails a genuine dev/CI run but always catches a bad
  // deploy.
  const gates = isProd
    ? [
        checks.supabaseConfigured,
        checks.serviceRoleConfigured,
        checks.paymentsSafe,
        checks.legacyAuthDisabled,
        checks.siteUrlConfigured,
        checks.internalTasksConfigured,
      ]
    : [checks.paymentsSafe, checks.legacyAuthDisabled, checks.siteUrlConfigured];
  const healthy = gates.every(Boolean) && (deep ? checks.database : true);

  const body = {
    status: healthy ? 'ok' : 'degraded',
    live: isLive,
    productionLike: isProd,
    checks,
    time: new Date().toISOString(),
  };
  return healthy
    ? jsonOk(body, { headers: { 'Cache-Control': 'no-store' } })
    : jsonError(503, 'unhealthy', 'One or more health checks failed', body, {
        'Cache-Control': 'no-store',
      });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
