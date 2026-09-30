import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetServerEnvCache } from '@/lib/config/env';

/**
 * The Supabase Send-Email hook calls Resend ITSELF, not through the notification provider — so the
 * sandbox's "every email goes to one inbox" rule (EMAIL_REDIRECT_TO) has to be honoured here too, or the
 * claim that nothing can reach anyone else would be false the day someone enables the hook on the
 * sandbox. Same rule, same helpers: tagged subject, banner, no Reply-To, refused on live payments.
 */
const SECRET_BYTES = new TextEncoder().encode('test-secret-key-material');
const SECRET = `v1,whsec_${btoa(String.fromCharCode(...SECRET_BYTES))}`;
const TESTER = 'tester@example.org';
const CUSTOMER = 'someone.real@customer.example';

async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    SECRET_BYTES,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

const { POST } = await import('../../app/api/v1/hooks/send-email/route');

async function hookRequest(): Promise<Request> {
  const body = JSON.stringify({
    user: { email: CUSTOMER },
    email_data: {
      email_action_type: 'recovery',
      token_hash: 'hash-abc',
      redirect_to: 'https://site.example/account',
    },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  return new Request('http://localhost/api/v1/hooks/send-email', {
    method: 'POST',
    headers: {
      'webhook-id': 'msg_1',
      'webhook-timestamp': ts,
      'webhook-signature': `v1,${await sign('msg_1', ts, body)}`,
    },
    body,
  });
}

const NAMES = [
  'SEND_EMAIL_HOOK_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'EMAIL_REDIRECT_TO',
  'NEXT_PUBLIC_SUPABASE_URL',
  'PEACH_ENVIRONMENT',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const n of NAMES) saved[n] = process.env[n];
  process.env.SEND_EMAIL_HOOK_SECRET = SECRET;
  process.env.RESEND_API_KEY = 're_sandbox_key';
  process.env.RESEND_FROM = 'accounts@example.com';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
  process.env.PEACH_ENVIRONMENT = 'test';
  delete process.env.EMAIL_REDIRECT_TO;
  resetServerEnvCache();
});

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
  resetServerEnvCache();
  vi.unstubAllGlobals();
});

function stubResend() {
  const sent: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('{}', { status: 200 });
    }),
  );
  return sent;
}

describe('POST /api/v1/hooks/send-email — sandbox redirect', () => {
  it('without a redirect, the email goes to the real user with Reply-To, as before', async () => {
    const sent = stubResend();
    const res = await POST(await hookRequest(), undefined);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(CUSTOMER);
    expect(String(sent[0]?.subject)).not.toContain('[sandbox');
    expect('reply_to' in (sent[0] ?? {})).toBe(true);
  });

  it('with EMAIL_REDIRECT_TO, it goes to that inbox ONLY — tagged, bannered, no Reply-To', async () => {
    process.env.EMAIL_REDIRECT_TO = TESTER;
    resetServerEnvCache();
    const sent = stubResend();
    const res = await POST(await hookRequest(), undefined);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const mail = sent[0] ?? {};
    expect(mail.to).toBe(TESTER);
    expect(String(mail.subject).startsWith(`[sandbox → ${CUSTOMER}] `)).toBe(true);
    expect(String(mail.html)).toContain('SANDBOX');
    expect(String(mail.html)).toContain(CUSTOMER);
    expect('reply_to' in mail).toBe(false);
    // The real user's address appears only as the tag — never as a recipient.
    expect(JSON.stringify(mail.to)).not.toContain('customer.example');
  });

  it('REFUSES (and sends nothing) when the redirect is set on a live-payments deployment', async () => {
    process.env.EMAIL_REDIRECT_TO = TESTER;
    process.env.PEACH_ENVIRONMENT = 'live';
    resetServerEnvCache();
    const sent = stubResend();
    const res = await POST(await hookRequest(), undefined);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(sent).toHaveLength(0);
  });
});
