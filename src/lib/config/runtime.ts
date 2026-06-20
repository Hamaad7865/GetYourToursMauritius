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
