import { getServerEnv, type ServerEnv } from '@/lib/config/env';
import { ConfigError } from '@/lib/services/errors';
import type { PaymentProvider } from './types';
import { PeachPaymentProvider, type PeachConfig } from './peach';
import { StubPaymentProvider } from './stub';

export * from './types';

/**
 * Builds the Peach config when every required value is present, else null. The Checkout API needs
 * the OAuth credentials (clientId/clientSecret/merchantId), the entity id, and the checkout base URL.
 * PEACH_AUTH_BASE_URL is optional — Peach serves the OAuth token endpoint and the checkout API on the
 * same host in most environments, so it defaults to the checkout base URL (override only if your
 * account splits them). PEACH_WEBHOOK_SECRET + PEACH_WEBHOOK_URL are optional (createCheckout works
 * without them) — they're only needed for HMAC webhook verification, which fails closed until both
 * exist (HMAC is activated by Peach support, not a dashboard toggle).
 */
function peachConfigFromEnv(env: ServerEnv): PeachConfig | null {
  if (
    env.PEACH_CLIENT_ID &&
    env.PEACH_CLIENT_SECRET &&
    env.PEACH_MERCHANT_ID &&
    env.PEACH_ENTITY_ID &&
    env.PEACH_CHECKOUT_BASE_URL
  ) {
    return {
      clientId: env.PEACH_CLIENT_ID,
      clientSecret: env.PEACH_CLIENT_SECRET,
      merchantId: env.PEACH_MERCHANT_ID,
      entityId: env.PEACH_ENTITY_ID,
      webhookSecret: env.PEACH_WEBHOOK_SECRET,
      authBaseUrl: env.PEACH_AUTH_BASE_URL ?? env.PEACH_CHECKOUT_BASE_URL,
      checkoutBaseUrl: env.PEACH_CHECKOUT_BASE_URL,
      webhookUrl: env.PEACH_WEBHOOK_URL,
      environment: env.PEACH_ENVIRONMENT,
    };
  }
  return null;
}

/**
 * Client-facing Peach widget config for the embedded pay page: the entity id (the widget `key`,
 * not secret — it's used in the browser) and the environment-appropriate checkout.js script URL.
 * Null when Peach isn't configured (dev/CI on the stub, which never reaches the embedded pay page).
 */
export function getPeachWidgetConfig(): { entityId: string; scriptUrl: string } | null {
  const env = getServerEnv();
  if (!env.PEACH_ENTITY_ID) return null;
  const scriptUrl =
    env.PEACH_ENVIRONMENT === 'live'
      ? 'https://checkout.peachpayments.com/js/checkout.js'
      : 'https://sandbox-checkout.peachpayments.com/js/checkout.js';
  return { entityId: env.PEACH_ENTITY_ID, scriptUrl };
}

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
  const peach = peachConfigFromEnv(env);
  if (peach) return new PeachPaymentProvider(peach);
  if (isProductionLikeRuntime(env)) {
    throw new ConfigError(
      'Refusing to serve the unauthenticated stub payment provider: this looks like a production ' +
        'deployment (Supabase service-role key configured, NODE_ENV=production, or ' +
        'PEACH_ENVIRONMENT=live) but Peach credentials are missing — the stub would confirm ' +
        'bookings without a verified payment. Set PEACH_CLIENT_ID, PEACH_CLIENT_SECRET, ' +
        'PEACH_MERCHANT_ID, PEACH_ENTITY_ID and PEACH_CHECKOUT_BASE_URL.',
    );
  }
  return new StubPaymentProvider();
}
