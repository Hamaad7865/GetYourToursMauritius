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
});
