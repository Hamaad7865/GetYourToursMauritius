import { beforeEach, describe, expect, it, vi } from 'vitest';

let country: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => new Headers(country ? { 'cf-ipcountry': country } : {}),
}));

const { GET } = await import('../../app/api/planner/locality/route');

async function ask(url = 'http://localhost/api/planner/locality') {
  const res = await GET(new Request(url));
  const body = (await res.json()) as {
    data: { mayUseDeviceLocation: boolean; onIsland: boolean };
  };
  return body.data;
}

/* Two answers from one header: the assistant's "use my location" stays offered when we can't tell
 * (fail-open), while the homepage's on-island row needs a CONFIRMED Mauritius (fail-closed). */
describe('GET /api/planner/locality', () => {
  beforeEach(() => {
    country = null;
  });

  it('says on the island only for a confirmed Mauritius', async () => {
    country = 'MU';
    expect(await ask()).toMatchObject({ onIsland: true, mayUseDeviceLocation: true });
  });

  it('says abroad for any other country', async () => {
    country = 'FR';
    expect(await ask()).toMatchObject({ onIsland: false, mayUseDeviceLocation: false });
  });

  it("does not count Cloudflare's can't-tell codes, or no header, as the island", async () => {
    country = 'XX';
    expect(await ask()).toMatchObject({ onIsland: false, mayUseDeviceLocation: true });
    country = null;
    expect(await ask()).toMatchObject({ onIsland: false, mayUseDeviceLocation: true });
  });

  it('ignores ?as= outside next dev', async () => {
    country = 'FR';
    const { onIsland } = await ask('http://localhost/api/planner/locality?as=island');
    expect(onIsland).toBe(false);
  });

  it('is never stored by a shared cache, and never names the country', async () => {
    country = 'MU';
    const res = await GET(new Request('http://localhost/api/planner/locality'));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).not.toContain('MU');
  });
});
