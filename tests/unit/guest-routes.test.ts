import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountRequiredError, RateLimitError } from '@/lib/services/errors';

/**
 * The two places a guest's JWT changes what a shared route does. Everything downstream is the
 * ordinary path, which tests/integration/guest-checkout.test.ts proves against real Postgres.
 */
const h = vi.hoisted(() => ({
  user: { id: 'guest-1', email: null, role: 'authenticated', isAnonymous: true } as {
    id: string;
    email: string | null;
    role: string;
    isAnonymous: boolean;
  },
  enabled: true,
  rateLimit: vi.fn(),
  verifyTurnstile: vi.fn(),
  assertGuestBookingAllowed: vi.fn(),
  createBooking: vi.fn(),
  createPaymentLink: vi.fn(),
  rpcLocales: [] as string[],
}));

vi.mock('@/lib/http/auth', () => ({
  requireUser: async () => h.user,
  requireAccount: async () => {
    if (h.user.isAnonymous) throw new AccountRequiredError();
    return h.user;
  },
}));
vi.mock('@/lib/http/rate-limit', () => ({ rateLimit: h.rateLimit, clientIp: () => '203.0.113.9' }));
vi.mock('@/lib/http/context', () => ({
  buildServiceContext: () => ({}),
  serviceRoleServiceContext: () => ({ admin: true }),
  serviceRoleRpcContext: (locale = 'en') => {
    h.rpcLocales.push(locale);
    return { locale };
  },
}));
vi.mock('@/lib/settings/guest-checkout', () => ({
  readGuestCheckoutConfig: async () => ({ enabled: h.enabled, turnstileSiteKey: 'site-key' }),
}));
vi.mock('@/lib/guest/turnstile', () => ({ verifyTurnstile: h.verifyTurnstile }));
vi.mock('@/lib/services/guest', () => ({
  assertGuestBookingAllowed: h.assertGuestBookingAllowed,
}));
vi.mock('@/lib/services/bookings', () => ({
  createBooking: h.createBooking,
  listMyBookings: vi.fn(),
}));
vi.mock('@/lib/services/payments', () => ({ createPaymentLink: h.createPaymentLink }));
vi.mock('@/lib/config/env', () => ({
  getServerEnv: () => ({ NEXT_PUBLIC_SITE_URL: 'https://example.test' }),
}));
vi.mock('@/lib/config/runtime', () => ({ isSiteUrlConfiguredForLive: () => true }));

const { POST: bookingsPost } = await import('../../app/api/v1/bookings/route');
const { POST: paymentsPost } = await import('../../app/api/v1/payments/route');

const OCCURRENCE = '11111111-2222-4333-8444-555555555555';
const body = {
  occurrenceId: OCCURRENCE,
  party: { Adult: 2 },
  customer: { name: 'Guest Person', email: 'guest@example.com' },
  source: 'whatsapp',
  idempotencyKey: 'guest-idem-key',
  turnstileToken: 'turnstile-response',
};

const postBooking = (cookie?: string) =>
  bookingsPost(
    new Request('https://example.test/api/v1/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );

const errorCode = async (res: Response) =>
  ((await res.json()) as { error?: { code?: string } }).error?.code;

beforeEach(() => {
  h.user = { id: 'guest-1', email: null, role: 'authenticated', isAnonymous: true };
  h.enabled = true;
  h.rpcLocales = [];
  vi.clearAllMocks();
  h.createBooking.mockResolvedValue({ ref: 'BMT123' });
  h.createPaymentLink.mockResolvedValue({ checkoutId: 'chk' });
});

describe('POST /api/v1/bookings for a guest', () => {
  it('books through every guest check, in order, with the verified id', async () => {
    const res = await postBooking();
    expect(res.status).toBe(201);
    expect(h.rateLimit).toHaveBeenCalledWith(expect.anything(), 'bookings:guest', 10, 3600);
    expect(h.verifyTurnstile).toHaveBeenCalledWith('turnstile-response', '203.0.113.9');
    expect(h.assertGuestBookingAllowed).toHaveBeenCalledWith(expect.anything(), {
      userId: 'guest-1',
      email: 'guest@example.com',
      idempotencyKey: 'guest-idem-key',
    });
    expect(h.createBooking.mock.calls[0]?.[2]).toBe('guest-1');
  });

  it('forces the source to web, so the link and the claim can find it', async () => {
    await postBooking();
    expect(h.createBooking.mock.calls[0]?.[1]).toMatchObject({ source: 'web' });
  });

  it('refuses with the switch off, before anything else runs', async () => {
    h.enabled = false;
    const res = await postBooking();
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('account_required');
    expect(h.createBooking).not.toHaveBeenCalled();
    expect(h.verifyTurnstile).not.toHaveBeenCalled();
  });

  it('books nothing when a cap refuses', async () => {
    h.assertGuestBookingAllowed.mockRejectedValueOnce(new RateLimitError('too many'));
    const res = await postBooking();
    expect(res.status).toBe(429);
    expect(h.createBooking).not.toHaveBeenCalled();
  });

  it('stores the language of the checkout, for the emails sent later', async () => {
    await postBooking('gytm_lang=fr');
    expect(h.rpcLocales).toContain('fr');
  });
});

describe('POST /api/v1/bookings for a real account', () => {
  it('skips every guest check, whatever the switch says', async () => {
    h.user = { id: 'user-1', email: 'a@b.co', role: 'authenticated', isAnonymous: false };
    h.enabled = false;
    const res = await postBooking('gytm_lang=fr');
    expect(res.status).toBe(201);
    expect(h.verifyTurnstile).not.toHaveBeenCalled();
    expect(h.assertGuestBookingAllowed).not.toHaveBeenCalled();
    expect(h.createBooking.mock.calls[0]?.[2]).toBe('user-1');
    expect(h.rpcLocales).toContain('fr');
  });
});

describe('POST /api/v1/payments', () => {
  const postPayment = () =>
    paymentsPost(
      new Request('https://example.test/api/v1/payments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingRef: 'BMT123', idempotencyKey: 'pay-key-123' }),
      }),
      { params: Promise.resolve({}) },
    );

  it('never offers a guest card storage: the purge deletes their user', async () => {
    await postPayment();
    expect(h.createPaymentLink.mock.calls[0]?.[1]).toMatchObject({
      saveCard: false,
      userId: undefined,
    });
  });

  it('still offers it to a real account', async () => {
    h.user = { id: 'user-1', email: 'a@b.co', role: 'authenticated', isAnonymous: false };
    await postPayment();
    expect(h.createPaymentLink.mock.calls[0]?.[1]).toMatchObject({
      saveCard: true,
      userId: 'user-1',
    });
  });
});
