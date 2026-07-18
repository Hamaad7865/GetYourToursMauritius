import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ searchActivities: vi.fn() }));

vi.mock('@/lib/services/activities', () => ({
  // The sitemap reads this to know how many items a full page may lose to filtering.
  CATALOGUE_HIDDEN_SLUGS: ['airport-transfer', 'hotel-transfer'],
  searchActivities: mocks.searchActivities,
}));

const { default: sitemap } = await import('../../app/sitemap');

const page = (slugs: string[]) => ({ items: slugs.map((slug) => ({ slug })), total: slugs.length });

beforeEach(() => {
  mocks.searchActivities.mockReset();
  mocks.searchActivities.mockResolvedValue(page(['catamaran-bbq']));
});

describe('sitemap', () => {
  it('includes static routes and one entry per published activity', async () => {
    const routes = await sitemap();
    const urls = routes.map((r) => r.url);
    expect(urls.some((u) => u.endsWith('/'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/activities'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/activities/catamaran-bbq'))).toBe(true);
  });

  it('includes the new SEO landing pages', async () => {
    const urls = (await sitemap()).map((r) => r.url);
    expect(urls.some((u) => u.endsWith('/mauritius-tours'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/mauritius-catamaran-cruise'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/dolphin-swim-mauritius'))).toBe(true);
  });

  it('drops the redirected singular /airport-transfer (kept only the /airport-transfers hub)', async () => {
    const urls = (await sitemap()).map((r) => r.url);
    // endsWith('/airport-transfer') is false for the plural '/airport-transfers', so this is exact.
    expect(urls.some((u) => u.endsWith('/airport-transfer'))).toBe(false);
    expect(urls.some((u) => u.endsWith('/airport-transfers'))).toBe(true);
  });

  it('keeps paging when a full page came back short because a hidden slug was filtered out', async () => {
    // searchActivities filters CATALOGUE_HIDDEN_SLUGS *after* the RPC, so a full 100-row page can
    // return 98 items. The loop used to compare that against pageSize and stop, silently dropping
    // every tour from the second page onward.
    const first = Array.from({ length: 98 }, (_, i) => `tour-${i}`);
    mocks.searchActivities
      .mockResolvedValueOnce(page(first))
      .mockResolvedValueOnce(page(['late-tour-a', 'late-tour-b']));

    const urls = (await sitemap()).map((r) => r.url);

    expect(urls.some((u) => u.endsWith('/activities/tour-0'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/activities/tour-97'))).toBe(true);
    // The page that would have been lost:
    expect(urls.some((u) => u.endsWith('/activities/late-tour-a'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/activities/late-tour-b'))).toBe(true);
    // ...and it still terminates on the genuinely short page rather than running to the 50-page cap.
    expect(mocks.searchActivities).toHaveBeenCalledTimes(2);
  });
});
