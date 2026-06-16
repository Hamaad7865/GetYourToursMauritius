import { getServerEnv, type ServerEnv } from '@/lib/config/env';
import { ConfigError } from '@/lib/services/errors';
import type { PaymentProvider } from './types';
import { PeachPaymentProvider } from './peach';
import { StubPaymentProvider } from './stub';

export * from './types';

/**
 * True when this process looks like a real / production deployment rather than local dev or CI.
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
function isProductionLikeRuntime(env: ServerEnv): boolean {
  if (process.env.NODE_ENV === 'development') return false;
  return (
    env.PEACH_ENVIRONMENT === 'live' ||
    process.env.NODE_ENV === 'production' ||
    Boolean(env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

/**
 * Selects the payment provider from the environment. Uses real Peach when fully
 * configured; otherwise the deterministic stub (local dev, CI, tests).
 *
 * FAIL CLOSED: the stub's `verifyWebhook` accepts ANY body and defaults the outcome to `paid`, so
 * the booking-confirmation webhook would mark bookings paid for free. That is fine for dev/CI but
 * catastrophic in production. When Peach is not fully configured we therefore REFUSE to serve the
 * stub on any signal that this is a real deployment (`isProductionLikeRuntime`) — a misconfigured
 * deploy throws here instead of silently exposing a free-booking endpoint.
 */
export function getPaymentProvider(): PaymentProvider {
  const env = getServerEnv();
  if (env.PEACH_ENTITY_ID && env.PEACH_ACCESS_TOKEN && env.PEACH_WEBHOOK_SECRET) {
    return new PeachPaymentProvider({
      entityId: env.PEACH_ENTITY_ID,
      accessToken: env.PEACH_ACCESS_TOKEN,
      webhookSecret: env.PEACH_WEBHOOK_SECRET,
      environment: env.PEACH_ENVIRONMENT,
    });
  }
  if (isProductionLikeRuntime(env)) {
    throw new ConfigError(
      'Refusing to serve the unauthenticated stub payment provider: this looks like a production ' +
        'deployment (Supabase service-role key configured, NODE_ENV=production, or ' +
        'PEACH_ENVIRONMENT=live) but Peach credentials are missing — the stub would confirm ' +
        'bookings without a verified payment. Set PEACH_ENTITY_ID, PEACH_ACCESS_TOKEN and ' +
        'PEACH_WEBHOOK_SECRET.',
    );
  }
  return new StubPaymentProvider();
}
