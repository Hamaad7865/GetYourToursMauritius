import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  values: {} as Record<string, string | undefined>,
}));
vi.mock('@/lib/config/env', () => ({ getServerEnv: () => env.values }));

const { guestLinkMessage, guestLinkTokenMatches, mintGuestLinkToken } =
  await import('@/lib/guest/link-token');
const {
  GUEST_LINK_COOKIE,
  bookingRefLooksValid,
  buildGuestLinkCookie,
  clearGuestLinkCookie,
  guestLinkLandingPath,
  guestLinkOpenPath,
  readGuestLinkCookie,
} = await import('@/lib/guest/link-cookie');
const { guestEmailCountKey, guestEmailKey, suggestEmailFix } =
  await import('@/lib/guest/email-key');
const { GET: openGet } = await import('../../app/api/v1/bookings/[ref]/open/route');

const BOOKING = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'a'.repeat(64);

beforeEach(() => {
  env.values = { GUEST_LINK_SECRET: 'secret-one' };
});

describe('guest link token', () => {
  it('is deterministic, so the drain can recompute it at send time', async () => {
    const a = await mintGuestLinkToken(BOOKING, 1);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await mintGuestLinkToken(BOOKING, 1)).toBe(a);
  });

  it('is scoped to the booking and the version', async () => {
    const token = await mintGuestLinkToken(BOOKING, 1);
    expect(await guestLinkTokenMatches(BOOKING, 1, token)).toBe(true);
    expect(await guestLinkTokenMatches(BOOKING, 2, token)).toBe(false);
    expect(await guestLinkTokenMatches('99999999-2222-4333-8444-555555555555', 1, token)).toBe(
      false,
    );
  });

  it('fails closed on the wrong shape', async () => {
    expect(await guestLinkTokenMatches(BOOKING, 1, '')).toBe(false);
    expect(await guestLinkTokenMatches(BOOKING, 1, 'A'.repeat(64))).toBe(false);
    expect(await guestLinkTokenMatches(BOOKING, 1, 'a'.repeat(63))).toBe(false);
  });

  it('never verifies as an installment token, which can share the secret', () => {
    expect(guestLinkMessage(BOOKING, 1)).toMatch(/^guest-link:v1:/);
  });

  it('keeps links in inboxes working through a rotation', async () => {
    const old = await mintGuestLinkToken(BOOKING, 1);
    env.values = { GUEST_LINK_SECRET: 'secret-two', GUEST_LINK_SECRET_PREVIOUS: 'secret-one' };
    expect(await guestLinkTokenMatches(BOOKING, 1, old)).toBe(true);
    expect(await mintGuestLinkToken(BOOKING, 1)).not.toBe(old);
  });

  it('keeps old links working when a dedicated secret is added later', async () => {
    env.values = { SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
    const old = await mintGuestLinkToken(BOOKING, 1);
    env.values = { GUEST_LINK_SECRET: 'dedicated', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
    expect(await guestLinkTokenMatches(BOOKING, 1, old)).toBe(true);
  });

  it('refuses to mint with no secret at all', async () => {
    env.values = {};
    await expect(mintGuestLinkToken(BOOKING, 1)).rejects.toThrow(/GUEST_LINK_SECRET/);
  });
});

describe('guest link cookie', () => {
  it('is httpOnly and reaches the adopt route alone', () => {
    const cookie = buildGuestLinkCookie('BMT123', TOKEN);
    expect(cookie).toContain(`${GUEST_LINK_COOKIE}=${TOKEN}`);
    expect(cookie).toContain('Path=/api/v1/bookings/BMT123/adopt');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=1800');
  });

  it('clears on the same path', () => {
    const cookie = clearGuestLinkCookie('BMT123');
    expect(cookie).toContain('Path=/api/v1/bookings/BMT123/adopt');
    expect(cookie).toContain('Max-Age=0');
  });

  it('reads back only a well-formed token', () => {
    const req = (cookie: string) => new Request('https://x.test/', { headers: { cookie } });
    expect(readGuestLinkCookie(req(`a=1; ${GUEST_LINK_COOKIE}=${TOKEN}`))).toBe(TOKEN);
    expect(readGuestLinkCookie(req(`${GUEST_LINK_COOKIE}=nope`))).toBeNull();
    expect(readGuestLinkCookie(new Request('https://x.test/'))).toBeNull();
  });

  it('refuses a ref that could break out of the cookie Path', () => {
    expect(bookingRefLooksValid('BMTE5CAD9FB1A5E3')).toBe(true);
    expect(bookingRefLooksValid('BMT;Domain=evil.test')).toBe(false);
    expect(bookingRefLooksValid('BMT 1')).toBe(false);
  });

  it('builds the emailed path, with the language for a French booking only', () => {
    expect(guestLinkOpenPath('BMT1', TOKEN, 'en')).toBe(`/api/v1/bookings/BMT1/open?t=${TOKEN}`);
    expect(guestLinkOpenPath('BMT1', TOKEN, 'fr')).toBe(
      `/api/v1/bookings/BMT1/open?t=${TOKEN}&l=fr`,
    );
    expect(guestLinkLandingPath('BMT1')).toBe('/bookings/BMT1?link=1');
  });
});

describe('GET /bookings/{ref}/open', () => {
  const open = (ref: string, query: string, cookie?: string) =>
    openGet(
      new Request(`https://x.test/api/v1/bookings/${ref}/open?${query}`, {
        headers: cookie ? { cookie } : {},
      }),
      { params: Promise.resolve({ ref }) },
    );

  it('moves the token into the cookie and leaves it out of the redirect', async () => {
    const res = await open('BMT123', `t=${TOKEN}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/bookings/BMT123?link=1');
    expect(res.headers.get('set-cookie')).toContain(TOKEN);
    expect(res.headers.get('location')).not.toContain(TOKEN);
  });

  it('answers a junk token the same way, with no cookie', async () => {
    const res = await open('BMT123', 't=junk');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/bookings/BMT123?link=1');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('lands a French guest in French on a device with no language cookie yet', async () => {
    const res = await open('BMT123', `t=${TOKEN}&l=fr`);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('gytm_lang=fr;'))).toBe(true);
    const english = await open('BMT123', `t=${TOKEN}`);
    expect(english.headers.getSetCookie().some((c) => c.startsWith('gytm_lang='))).toBe(false);
  });

  it('leaves a language the visitor already chose alone', async () => {
    const res = await open('BMT123', `t=${TOKEN}&l=fr`, 'gytm_lang=en');
    expect(res.headers.getSetCookie().some((c) => c.startsWith('gytm_lang='))).toBe(false);
  });

  it('touches no database: a mail scanner fetching this changes nothing', () => {
    // The module graph is the proof. `env` above is the only dependency mocked, and a client or an
    // rpc call here would need a configured Supabase. Pinned on the source so it cannot creep in.
    const source = readRoute();
    expect(source).not.toMatch(/rateLimit|createServiceRoleClient|serviceRole|callRpc|\.from\(/);
  });
});

function readRoute(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  return readFileSync('app/api/v1/bookings/[ref]/open/route.ts', 'utf8');
}

describe('emails rendered inside the Resend provider', () => {
  it('use the signed link when the drain set one, and the plain page otherwise', async () => {
    const { ResendNotificationProvider } = await import('@/lib/notifications/resend');
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body).text as string);
      return new Response(JSON.stringify({ id: 'email' }), { status: 200 });
    });
    const provider = new ResendNotificationProvider({ apiKey: 'k', from: 'a@b.co' });
    const message = {
      id: 'n1',
      channel: 'email' as const,
      recipient: 'guest@example.com',
      template: 'booking_weather_disrupted',
    };
    const signed = 'https://example.test/api/v1/bookings/BMT1/open?t=abc';

    await provider.send({ ...message, payload: { ref: 'BMT1', bookingUrl: signed } });
    await provider.send({ ...message, payload: { ref: 'BMT1' } });
    vi.unstubAllGlobals();

    expect(sent[0]).toContain(`Choose here: ${signed}`);
    expect(sent[1]).toContain('/bookings/BMT1');
    expect(sent[1]).not.toContain('/open?t=');
  });
});

describe('email keys', () => {
  it('mirrors quote_email_key: lower, trimmed, null for blank', () => {
    expect(guestEmailKey('  Anna@Example.COM ')).toBe('anna@example.com');
    expect(guestEmailKey('   ')).toBeNull();
    expect(guestEmailKey(null)).toBeNull();
  });

  it('collapses +tags for counting only', () => {
    expect(guestEmailCountKey('Anna+trip1@Example.com')).toBe('anna@example.com');
    expect(guestEmailKey('Anna+trip1@Example.com')).toBe('anna+trip1@example.com');
  });

  it('offers a fix for a known domain slip, and nothing else', () => {
    expect(suggestEmailFix('sam@gmial.com')).toBe('sam@gmail.com');
    expect(suggestEmailFix(' sam@HOTMIAL.com ')).toBe('sam@hotmail.com');
    expect(suggestEmailFix('sam@gmail.com')).toBeNull();
    expect(suggestEmailFix('not an email')).toBeNull();
  });
});
