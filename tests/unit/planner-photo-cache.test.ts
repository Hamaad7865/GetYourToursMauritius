import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/http/rate-limit', () => ({ rateLimit: vi.fn(), clientIp: () => '203.0.113.9' }));
vi.mock('@/lib/config/env', () => ({ getServerEnv: () => ({ GOOGLE_MAPS_API_KEY: 'k' }) }));

import { GET } from '../../app/api/planner/photo/route';

/** Every Places photo fetch is billed. A Pages Function response is not kept by Cloudflare's CDN just
 *  because it sends Cache-Control, so the route stores the photo in the edge cache itself. */
describe('GET /api/planner/photo edge cache', () => {
  const store = new Map<string, Response>();
  const fetchMock = vi.fn();
  const url = 'https://bellemaretours.com/api/planner/photo?ref=places/abc/photos/def';

  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () => new Response('jpeg-bytes', { headers: { 'content-type': 'image/jpeg' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', {
      default: {
        match: async (req: Request) => store.get(req.url)?.clone(),
        put: async (req: Request, res: Response) => void store.set(req.url, res),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('bills Google once, then serves the photo from the edge cache', async () => {
    const first = await GET(new Request(url));
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('jpeg-bytes');

    const second = await GET(new Request(url));
    expect(second.status).toBe(200);
    expect(await second.text()).toBe('jpeg-bytes');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still serves photos where no edge cache exists (next dev)', async () => {
    vi.stubGlobal('caches', undefined);
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
