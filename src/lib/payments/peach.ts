import type { CheckoutSession, PaymentEvent, PaymentProvider, VerifyWebhookInput } from './types';
import { NotImplementedError } from '@/lib/services/errors';

export interface PeachConfig {
  entityId: string;
  accessToken: string;
  webhookSecret: string;
  environment: 'test' | 'live';
}

/**
 * Peach Payments hosted-checkout provider. Edge-safe (fetch-based, Web Crypto for
 * signature verification). The concrete request/verify logic lands in Phase 4;
 * the class exists now so the factory and interface are real from Phase 0.
 */
export class PeachPaymentProvider implements PaymentProvider {
  readonly name = 'peach';

  constructor(private readonly config: PeachConfig) {}

  async createCheckout(): Promise<CheckoutSession> {
    throw new NotImplementedError(
      `PeachPaymentProvider.createCheckout [${this.config.environment}]`,
    );
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<PaymentEvent> {
    throw new NotImplementedError(
      `PeachPaymentProvider.verifyWebhook [${this.config.environment}]`,
    );
  }
}
