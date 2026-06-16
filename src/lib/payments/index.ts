import { getServerEnv } from '@/lib/config/env';
import { ConfigError } from '@/lib/services/errors';
import type { PaymentProvider } from './types';
import { PeachPaymentProvider } from './peach';
import { StubPaymentProvider } from './stub';

export * from './types';

/**
 * Selects the payment provider from the environment. Uses real Peach when fully
 * configured; otherwise the deterministic stub (local dev, CI, tests).
 *
 * FAIL CLOSED: the stub's `verifyWebhook` accepts ANY body and defaults the outcome to
 * `paid`, so the booking-confirmation webhook would mark bookings paid for free. That is
 * fine for dev/CI but catastrophic in production. If `PEACH_ENVIRONMENT=live` we therefore
 * REFUSE to fall back to the stub when the Peach credentials are missing — a misconfigured
 * live deploy throws here instead of silently exposing a free-booking endpoint.
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
  if (env.PEACH_ENVIRONMENT === 'live') {
    throw new ConfigError(
      'PEACH_ENVIRONMENT=live but Peach credentials are missing. Refusing to serve the ' +
        'unauthenticated stub payment provider in production (it would confirm bookings without ' +
        'a verified payment). Set PEACH_ENTITY_ID, PEACH_ACCESS_TOKEN and PEACH_WEBHOOK_SECRET.',
    );
  }
  return new StubPaymentProvider();
}
