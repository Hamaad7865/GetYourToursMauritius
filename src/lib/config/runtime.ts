import type { ServerEnv } from './env';

/**
 * True when this process looks like a real / production deployment rather than local dev or CI.
 *
 * This is the project's single canonical "are we live?" signal. Factories that fall back to an
 * unsafe stub when their provider is unconfigured (payments, notifications, and any future one)
 * use this to FAIL CLOSED on a real deployment instead of silently serving the stub.
 *
 * The gate must NOT key on `PEACH_ENVIRONMENT`: its schema default is `'test'`, i.e. the UNSAFE
 * value, so a production deploy that simply forgets to set it would silently fall through. Instead
 * we look at signals that are set by the platform or the real backend and are therefore present
 * exactly when it matters: a configured Supabase service-role key (the webhook needs it to run at
 * all), `NODE_ENV=production` (set by the build/runtime, not hand-managed), or an explicit
 * `PEACH_ENVIRONMENT=live`.
 *
 * EXCEPTION: `next dev` (NODE_ENV=development) legitimately runs with a live Supabase service-role
 * key for local admin/webhook testing, yet is NOT a production deploy — the stub is correct there.
 * So development is never treated as production-like (production sets NODE_ENV=production; the test
 * runner runs as 'test', which still honours the service-role-key signal).
 */
export function isProductionLikeRuntime(env: ServerEnv): boolean {
  if (process.env.NODE_ENV === 'development') return false;
  return (
    env.PEACH_ENVIRONMENT === 'live' ||
    process.env.NODE_ENV === 'production' ||
    Boolean(env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

/**
 * True when `url` points at the local loopback host (localhost / 127.0.0.1 / ::1, any port).
 * This is the schema default for `NEXT_PUBLIC_SITE_URL`, so an unset/typo'd value in a real deploy
 * silently becomes a loopback URL — which is load-bearing on the money path (it builds the Peach
 * return URL + Origin) and on every canonical/OG/sitemap link. A malformed URL is treated as a
 * loopback (not configured) too: better to fail closed than ship a bad return URL.
 */
export function isLocalhostUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost')
  );
}

/**
 * True when `NEXT_PUBLIC_SITE_URL` is safe to use for live customer-facing flows: either we are NOT
 * production-like (local dev / CI / tests legitimately run on the localhost default), or we are
 * production-like AND the site URL is a real non-loopback origin. Reused by the payments money-path
 * guard and the health readiness gate so both agree on what "configured for live" means.
 */
export function isSiteUrlConfiguredForLive(env: ServerEnv): boolean {
  if (!isProductionLikeRuntime(env)) return true;
  return !isLocalhostUrl(env.NEXT_PUBLIC_SITE_URL);
}
