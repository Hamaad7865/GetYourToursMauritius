import { getServerEnv } from '@/lib/config/env';
import type { NotificationProvider } from './types';
import { StubNotificationProvider } from './stub';
import { ResendNotificationProvider } from './resend';

export * from './types';

/** Resend when RESEND_API_KEY + RESEND_FROM are set; otherwise the no-op stub (dev/CI). */
export function getNotificationProvider(): NotificationProvider {
  const env = getServerEnv();
  if (env.RESEND_API_KEY && env.RESEND_FROM) {
    return new ResendNotificationProvider({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
  }
  return new StubNotificationProvider();
}
