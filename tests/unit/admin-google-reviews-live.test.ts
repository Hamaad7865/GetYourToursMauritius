import { afterEach, describe, expect, it, vi } from 'vitest';

// loadGoogleReviewsLive pulls the browser Supabase client for the auth header; stub it (no session).
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

const { loadGoogleReviewsLive } = await import('@/lib/admin/reviews');

describe('loadGoogleReviewsLive', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('unwraps the { ok, data } envelope on a successful response', async () => {
    const payload = {
      rating: 4.7,
      userRatingCount: 117,
      reviews: [
        {
          authorName: 'Charles Bradley',
          authorPhotoUrl: null,
          rating: 5,
          text: 'Great trip',
          relativeTime: '9 months ago',
          googleMapsUri: null,
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, data: payload }), { status: 200 })),
    );
    await expect(loadGoogleReviewsLive('place-id')).resolves.toEqual(payload);
  });

  it('throws the envelope error message on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: { message: 'Google Maps API key is not configured' },
            }),
            { status: 503 },
          ),
      ),
    );
    await expect(loadGoogleReviewsLive('place-id')).rejects.toThrow(
      'Google Maps API key is not configured',
    );
  });

  it('throws a generic message on a non-JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>gateway error</html>', { status: 502 })),
    );
    await expect(loadGoogleReviewsLive('place-id')).rejects.toThrow(
      'Could not load Google reviews.',
    );
  });
});
