import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAccountGalleries } from '@/lib/booking/account-galleries-client';
import type { GalleryCard } from '@/lib/booking/gallery-cards';

/**
 * The browser side of the account Galleries list: the nav and the page ask for the same list on the
 * same navigation, so they must share one request — and every way the call can go wrong must come out
 * as null ("couldn't load"), never as an empty list that would read as "no galleries".
 */
const CARD: GalleryCard = {
  ref: 'BMT2ABCD',
  packageTitle: 'Couples shoot',
  shootDate: '2026-10-10T06:00:00.000Z',
  photoCount: 24,
  videoCount: 0,
  access: 'locked',
  coverUrl: 'https://cdn.example/covers/couples.jpg',
  balanceDueMinor: 32500,
};

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAccountGalleries', () => {
  it('sends the bearer token and reads the { ok, data } envelope', async () => {
    const fetchMock = vi.fn(async () => okResponse({ ok: true, data: { galleries: [CARD] } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchAccountGalleries('token-1')).resolves.toEqual([CARD]);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/account/galleries', {
      headers: { authorization: 'Bearer token-1' },
    });
  });

  it('answers [] for a customer with no galleries — and null when it could not load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ ok: true, data: { galleries: [] } })),
    );
    await expect(fetchAccountGalleries('t-empty')).resolves.toEqual([]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    await expect(fetchAccountGalleries('t-500')).resolves.toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    await expect(fetchAccountGalleries('t-401')).resolves.toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    await expect(fetchAccountGalleries('t-net')).resolves.toBeNull();

    // A 200 whose body is not the envelope (the raw-body mistake) is a failure, not "no galleries".
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse({ galleries: [CARD] })),
    );
    await expect(fetchAccountGalleries('t-bare')).resolves.toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 })),
    );
    await expect(fetchAccountGalleries('t-html')).resolves.toBeNull();
  });

  it('shares ONE request between concurrent callers with the same token, then asks again later', async () => {
    const fetchMock = vi.fn(async () => okResponse({ ok: true, data: { galleries: [CARD] } }));
    vi.stubGlobal('fetch', fetchMock);
    const [nav, page] = await Promise.all([
      fetchAccountGalleries('shared'),
      fetchAccountGalleries('shared'),
    ]);
    expect(nav).toEqual([CARD]);
    expect(page).toEqual([CARD]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Settled: the next navigation gets fresh data rather than a stale cached answer.
    await fetchAccountGalleries('shared');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never shares a request across different tokens (different customers)', async () => {
    const fetchMock = vi.fn(async () => okResponse({ ok: true, data: { galleries: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([fetchAccountGalleries('token-a'), fetchAccountGalleries('token-b')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
