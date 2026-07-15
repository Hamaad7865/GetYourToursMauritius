import { afterEach, describe, expect, it } from 'vitest';
import { getNotificationProvider } from '@/lib/notifications';
import { resetServerEnvCache } from '@/lib/config/env';
import type { NotificationMessage } from '@/lib/notifications/types';

/**
 * The stub provider's send() resolves doing NOTHING, so the drain would mark every booking email
 * 'sent' and silently black-hole it. It must therefore never be served on a production-like runtime
 * when Resend is unconfigured — getNotificationProvider() returns a fail-closed provider whose
 * send() throws, so the drain records the row 'failed' (retried once a key is set) and it stays
 * visible. The "is live" signal is the shared isProductionLikeRuntime gate (same one payments uses):
 * vitest runs as NODE_ENV=test, so a configured Supabase service-role key makes it production-like.
 */
const sampleMessage: NotificationMessage = {
  id: 'n1',
  channel: 'email',
  recipient: 'guest@example.com',
  template: 'booking_confirmation',
  payload: {},
};

describe('getNotificationProvider — fail-closed', () => {
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.TELEGRAM_BOT_TOKEN;
    process.env.PEACH_ENVIRONMENT = 'test';
    resetServerEnvCache();
  });

  it('uses the no-op stub in local dev / CI (no production signals) when RESEND_* is absent', () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.PEACH_ENVIRONMENT = 'test';
    resetServerEnvCache();
    expect(getNotificationProvider().name).toBe('email:stub whatsapp:stub telegram:stub');
  });

  it('the stub send() resolves (so dev / CI / tests run the drain end-to-end offline)', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();
    await expect(getNotificationProvider().send(sampleMessage)).resolves.toBeUndefined();
  });

  it('FAILS CLOSED on a production-like runtime (service-role key set) when RESEND_* is missing', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-present';
    resetServerEnvCache();

    const provider = getNotificationProvider();
    expect(provider.name).toBe('email:fail-closed whatsapp:fail-closed telegram:fail-closed');
    // A throwing send() is what makes the drain mark the row 'failed' (NOT 'sent') and retry it.
    await expect(provider.send(sampleMessage)).rejects.toThrow(/notifications_not_configured/);
  });

  it('FAILS CLOSED when PEACH_ENVIRONMENT=live and RESEND_* is missing', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.PEACH_ENVIRONMENT = 'live';
    resetServerEnvCache();
    expect(getNotificationProvider().name).toBe(
      'email:fail-closed whatsapp:fail-closed telegram:fail-closed',
    );
  });

  it('uses the real Resend provider when RESEND_API_KEY + RESEND_FROM are set (even in production)', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM = 'bookings@example.com';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-present';
    resetServerEnvCache();
    expect(getNotificationProvider().name).toBe(
      'email:resend whatsapp:fail-closed telegram:fail-closed',
    );
  });

  it('uses the real Telegram provider for owner alerts when TELEGRAM_BOT_TOKEN is set', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM = 'bookings@example.com';
    process.env.TELEGRAM_BOT_TOKEN = '123456:AA-bot-token';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-present';
    resetServerEnvCache();
    expect(getNotificationProvider().name).toBe(
      'email:resend whatsapp:fail-closed telegram:telegram-bot',
    );
  });
});
