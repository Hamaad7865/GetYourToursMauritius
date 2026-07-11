import { afterEach, describe, expect, it, vi } from 'vitest';

// holdClient pulls the browser Supabase client for the auth header; stub it (no session = anon).
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

const { fetchMyPendingBookings } = await import('@/lib/cart/holdClient');

describe('fetchMyPendingBookings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the data array on a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, data: [{ ref: 'BMT-1' }] }), { status: 200 }),
      ),
    );
    expect(await fetchMyPendingBookings()).toEqual([{ ref: 'BMT-1' }]);
  });

  it('returns [] on a 401 (anonymous visitor)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: { code: 'unauthorized' } }), {
            status: 401,
          }),
      ),
    );
    expect(await fetchMyPendingBookings()).toEqual([]);
  });

  it('never throws — a network error yields []', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await fetchMyPendingBookings()).toEqual([]);
  });
});
