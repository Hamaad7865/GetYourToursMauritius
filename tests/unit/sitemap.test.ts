import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/activities', () => ({
  searchActivities: async () => ({ items: [{ slug: 'catamaran-bbq' }], total: 1 }),
}));

const { default: sitemap } = await import('../../app/sitemap');

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
});
