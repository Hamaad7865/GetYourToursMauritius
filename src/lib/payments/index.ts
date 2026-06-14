import { getServerEnv } from '@/lib/config/env';
import type { PaymentProvider } from './types';
import { PeachPaymentProvider } from './peach';
import { StubPaymentProvider } from './stub';

export * from './types';

/**
 * Selects the payment provider from the environment. Uses real Peach when fully
 * configured; otherwise the deterministic stub (local dev, CI, tests).
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
  return new StubPaymentProvider();
}
