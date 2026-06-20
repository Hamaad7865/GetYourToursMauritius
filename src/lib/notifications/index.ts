import { getServerEnv } from '@/lib/config/env';
import { isProductionLikeRuntime } from '@/lib/config/runtime';
import type { NotificationProvider } from './types';
import { StubNotificationProvider } from './stub';
import { FailClosedNotificationProvider } from './fail-closed';
import { ResendNotificationProvider } from './resend';

export * from './types';

/**
 * Selects the notification provider from the environment.
 *
 * - Resend when `RESEND_API_KEY` + `RESEND_FROM` are set (the real provider).
 * - Otherwise FAIL CLOSED on a production-like runtime: the stub's `send()` resolves doing nothing,
 *   so the drain would mark every booking email `sent` and silently black-hole it. On a real
 *   deployment we instead return a provider whose `send()` throws, so the drain marks the row
 *   `failed` (retried once a key is set) and the outbox row stays visible.
 * - Otherwise the no-op stub (local dev / CI / tests run end-to-end with no email account).
 */
export function getNotificationProvider(): NotificationProvider {
  const env = getServerEnv();
  if (env.RESEND_API_KEY && env.RESEND_FROM) {
    return new ResendNotificationProvider({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
  }
  if (isProductionLikeRuntime(env)) {
    return new FailClosedNotificationProvider();
  }
  return new StubNotificationProvider();
}
