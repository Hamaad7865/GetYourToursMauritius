import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildVerifyUrl,
  kindFor,
  resolveLang,
  verifyHookSignature,
  type SendEmailHookPayload,
} from '@/lib/auth-emails/hook';
import { renderAuthEmail } from '@/lib/auth-emails/templates';

/**
 * Supabase Send-Email Auth Hook — the bilingual replacement for the single-language dashboard
 * templates. The signature scheme is Standard Webhooks: base64(HMAC-SHA256(secret,
 * `${id}.${timestamp}.${body}`)) with the secret's base64 part decoded to key BYTES.
 */

const SECRET_BYTES = new TextEncoder().encode('test-secret-key-material');
const SECRET = `v1,whsec_${btoa(String.fromCharCode(...SECRET_BYTES))}`;

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

const nowSec = () => String(Math.floor(Date.now() / 1000));

describe('verifyHookSignature (Standard Webhooks)', () => {
  it('accepts a correctly signed payload', async () => {
    const body = '{"a":1}';
    const ts = nowSec();
    const sig = await sign('msg_1', ts, body);
    await expect(
      verifyHookSignature({
        secret: SECRET,
        rawBody: body,
        headers: { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` },
      }),
    ).resolves.toBe(true);
  });

  it('accepts when OUR signature is one of several space-separated entries (key rotation)', async () => {
    const body = '{"a":1}';
    const ts = nowSec();
    const sig = await sign('msg_1', ts, body);
    await expect(
      verifyHookSignature({
        secret: SECRET,
        rawBody: body,
        headers: { id: 'msg_1', timestamp: ts, signature: `v1,AAAA v1,${sig}` },
      }),
    ).resolves.toBe(true);
  });

  it('rejects a tampered body, a wrong id, and a missing header', async () => {
    const ts = nowSec();
    const sig = await sign('msg_1', ts, '{"a":1}');
    await expect(
      verifyHookSignature({
        secret: SECRET,
        rawBody: '{"a":2}', // tampered
        headers: { id: 'msg_1', timestamp: ts, signature: `v1,${sig}` },
      }),
    ).resolves.toBe(false);
    await expect(
      verifyHookSignature({
        secret: SECRET,
        rawBody: '{"a":1}',
        headers: { id: 'msg_2', timestamp: ts, signature: `v1,${sig}` },
      }),
    ).resolves.toBe(false);
    await expect(
      verifyHookSignature({
        secret: SECRET,
        rawBody: '{"a":1}',
        headers: { id: 'msg_1', timestamp: ts, signature: null },
      }),
    ).resolves.toBe(false);
  });

  it('rejects a stale timestamp (replay window is ±5 minutes)', async () => {
    const body = '{"a":1}';
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    const sig = await sign('msg_1', stale, body);
    await expect(
      verifyHookSignature({
        secret: SECRET,
        rawBody: body,
        headers: { id: 'msg_1', timestamp: stale, signature: `v1,${sig}` },
      }),
    ).resolves.toBe(false);
  });
});

describe('resolveLang', () => {
  const base: SendEmailHookPayload = {
    user: { email: 'x@example.com' },
    email_data: { email_action_type: 'recovery' },
  };

  it('prefers user_metadata.lang (the language the account signed up in)', () => {
    expect(resolveLang({ ...base, user: { ...base.user, user_metadata: { lang: 'fr' } } })).toBe(
      'fr',
    );
  });

  it('falls back to ?lang= on the redirect URL (the signed-out reset path)', () => {
    expect(
      resolveLang({
        ...base,
        email_data: {
          ...base.email_data,
          redirect_to: 'https://bellemaretours.com/auth/reset-password?lang=fr',
        },
      }),
    ).toBe('fr');
  });

  it('defaults to English on no signal or a junk value', () => {
    expect(resolveLang(base)).toBe('en');
    expect(resolveLang({ ...base, user: { ...base.user, user_metadata: { lang: 'zz' } } })).toBe(
      'en',
    );
  });
});

describe('kindFor + buildVerifyUrl', () => {
  it('maps every known action type and refuses unknown ones', () => {
    expect(kindFor('recovery')).toBe('recovery');
    expect(kindFor('signup')).toBe('signup');
    expect(kindFor('invite')).toBe('signup');
    expect(kindFor('magiclink')).toBe('magiclink');
    expect(kindFor('email_change')).toBe('email_change');
    expect(kindFor('reauthentication')).toBe('reauthentication');
    expect(kindFor('something_new')).toBeNull();
    expect(kindFor(undefined)).toBeNull();
  });

  it('builds the GoTrue verify link Supabase itself would have used', () => {
    const url = new URL(
      buildVerifyUrl({
        supabaseUrl: 'https://proj.supabase.co',
        tokenHash: 'hash123',
        actionType: 'recovery',
        redirectTo: 'https://bellemaretours.com/auth/reset-password?lang=fr',
      }),
    );
    expect(url.origin).toBe('https://proj.supabase.co');
    expect(url.pathname).toBe('/auth/v1/verify');
    expect(url.searchParams.get('token')).toBe('hash123');
    expect(url.searchParams.get('type')).toBe('recovery');
    expect(url.searchParams.get('redirect_to')).toBe(
      'https://bellemaretours.com/auth/reset-password?lang=fr',
    );
  });
});

describe('renderAuthEmail (bilingual)', () => {
  it('renders French copy for fr and English for en, same layout', () => {
    const fr = renderAuthEmail({
      kind: 'recovery',
      lang: 'fr',
      email: 'client@example.com',
      actionUrl: 'https://x/verify',
    });
    const en = renderAuthEmail({
      kind: 'recovery',
      lang: 'en',
      email: 'client@example.com',
      actionUrl: 'https://x/verify',
    });
    expect(fr.subject).toBe('Réinitialisez votre mot de passe Belle Mare Tours');
    expect(fr.html).toContain('Choisir un nouveau mot de passe');
    expect(en.subject).toBe('Reset your Belle Mare Tours password');
    expect(en.html).toContain('Set a new password');
    // Both carry the brand shell: live PNG logo (clients can't render SVG) + teal-dark button.
    for (const mail of [fr, en]) {
      expect(mail.html).toContain('/logo.png');
      expect(mail.html).toContain('#0b5c63');
      expect(mail.html).toContain('https://x/verify');
    }
  });

  it('escapes the interpolated email address (an address is attacker-typed input)', () => {
    const out = renderAuthEmail({
      kind: 'magiclink',
      lang: 'en',
      email: '<img src=x onerror=alert(1)>@example.com',
      actionUrl: 'https://x/verify',
    });
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;img src=x');
  });

  it('reauthentication renders the OTP code instead of a button', () => {
    const out = renderAuthEmail({
      kind: 'reauthentication',
      lang: 'en',
      email: 'x@example.com',
      code: '123456',
    });
    expect(out.html).toContain('123456');
    expect(out.html).not.toContain('href=""');
  });
});

describe('POST /api/v1/hooks/send-email (route)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock('@/lib/config/env');
  });

  async function importRoute(env: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock('@/lib/config/env', () => ({ getServerEnv: () => env }));
    const mod = await import('../../app/api/v1/hooks/send-email/route');
    return mod.POST;
  }

  const ENV = {
    SEND_EMAIL_HOOK_SECRET: SECRET,
    RESEND_API_KEY: 're_test',
    RESEND_FROM: 'Belle Mare Tours <bookings@example.com>',
    AUTH_EMAIL_FROM: 'Belle Mare Tours <accounts@example.com>',
    NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
  };

  async function signedRequest(payload: unknown): Promise<Request> {
    const body = JSON.stringify(payload);
    const ts = nowSec();
    const sig = await sign('msg_route', ts, body);
    return new Request('http://localhost/api/v1/hooks/send-email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': 'msg_route',
        'webhook-timestamp': ts,
        'webhook-signature': `v1,${sig}`,
      },
      body,
    });
  }

  it('sends a FRENCH reset email through Resend for a fr-metadata user', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response('{"id":"email_1"}', { status: 200 });
      }),
    );
    const POST = await importRoute(ENV);
    const res = await POST(
      await signedRequest({
        user: { email: 'client@example.com', user_metadata: { lang: 'fr' } },
        email_data: {
          token_hash: 'hash_abc',
          email_action_type: 'recovery',
          redirect_to: 'https://bellemaretours.com/auth/reset-password?lang=fr',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.body.to).toBe('client@example.com');
    expect(calls[0]!.body.from).toBe('Belle Mare Tours <accounts@example.com>');
    expect(calls[0]!.body.subject).toBe('Réinitialisez votre mot de passe Belle Mare Tours');
    // The href is HTML-attribute-escaped (& → &amp;) — correct escaping, so match the escaped form.
    expect(String(calls[0]!.body.html)).toContain(
      'https://proj.supabase.co/auth/v1/verify?token=hash_abc&amp;type=recovery',
    );
  });

  it('rejects a bad signature with 401 and never calls Resend', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const POST = await importRoute(ENV);
    const res = await POST(
      new Request('http://localhost/api/v1/hooks/send-email', {
        method: 'POST',
        headers: {
          'webhook-id': 'msg_x',
          'webhook-timestamp': nowSec(),
          'webhook-signature': 'v1,Zm9yZ2VkforgedAAAA',
        },
        body: '{"user":{},"email_data":{}}',
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('503s when the hook secret is not deployed (loud, not a silent black hole)', async () => {
    const POST = await importRoute({ ...ENV, SEND_EMAIL_HOOK_SECRET: undefined });
    const res = await POST(
      new Request('http://localhost/api/v1/hooks/send-email', { method: 'POST', body: '{}' }),
    );
    expect(res.status).toBe(503);
  });

  it('secure email change sends TWO emails: current address + new address', async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)));
        return new Response('{"id":"ok"}', { status: 200 });
      }),
    );
    const POST = await importRoute(ENV);
    const res = await POST(
      await signedRequest({
        user: { email: 'old@example.com', new_email: 'new@example.com' },
        email_data: {
          token_hash: 'hash_old',
          token_hash_new: 'hash_new',
          email_action_type: 'email_change',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.to)).toEqual(['old@example.com', 'new@example.com']);
    expect(String(calls[0]!.html)).toContain('token=hash_old');
    expect(String(calls[1]!.html)).toContain('token=hash_new');
  });

  it('a Resend failure answers 500 so the auth call fails visibly (retryable)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('quota', { status: 429 })),
    );
    const POST = await importRoute(ENV);
    const res = await POST(
      await signedRequest({
        user: { email: 'client@example.com' },
        email_data: { token_hash: 'h', email_action_type: 'recovery' },
      }),
    );
    expect(res.status).toBe(500);
  });

  it('an unknown action type answers 422 — never a fake success', async () => {
    const POST = await importRoute(ENV);
    const res = await POST(
      await signedRequest({
        user: { email: 'client@example.com' },
        email_data: { token_hash: 'h', email_action_type: 'brand_new_flow' },
      }),
    );
    expect(res.status).toBe(422);
  });
});
