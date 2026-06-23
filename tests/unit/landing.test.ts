import { describe, expect, it, beforeEach, vi } from 'vitest';

// vi.hoisted so the controllable mock fn exists before the hoisted vi.mock factory references it.
const { searchActivities } = vi.hoisted(() => ({ searchActivities: vi.fn() }));
vi.mock('@/lib/services/activities', () => ({ searchActivities }));
vi.mock('@/lib/http/context', () => ({ publicServiceContext: () => ({}) }));

const { featuredActivities } = await import('@/lib/seo/landing');

const item = (slug: string) => ({ slug });

beforeEach(() => searchActivities.mockReset());

describe('featuredActivities', () => {
  it('returns category matches when the category is populated', async () => {
    searchActivities.mockResolvedValueOnce({ items: [item('catamaran-bbq')], total: 1 });
    const out = await featuredActivities({ category: 'Catamaran cruises', q: 'catamaran' });
    expect(out).toHaveLength(1);
    expect(searchActivities).toHaveBeenCalledTimes(1);
    expect(searchActivities.mock.calls[0]![1]).toMatchObject({ category: 'Catamaran cruises' });
  });

  it('falls back to the text query when the category matches nothing', async () => {
    searchActivities
      .mockResolvedValueOnce({ items: [], total: 0 }) // category miss
      .mockResolvedValueOnce({ items: [item('dolphin-am')], total: 1 }); // q hit
    const out = await featuredActivities({ category: 'Dolphin swims', q: 'dolphin' });
    expect(out).toHaveLength(1);
    expect(searchActivities).toHaveBeenCalledTimes(2);
    expect(searchActivities.mock.calls[1]![1]).toMatchObject({ q: 'dolphin' });
  });

  it('returns [] for a targeted page that matches nothing (no off-topic broad fallback)', async () => {
    searchActivities.mockResolvedValue({ items: [], total: 0 });
    const out = await featuredActivities({ category: 'Catamaran cruises', q: 'catamaran' });
    expect(out).toEqual([]);
    expect(searchActivities).toHaveBeenCalledTimes(2);
  });

  it('does a broad listing for hub pages with no category or query', async () => {
    searchActivities.mockResolvedValueOnce({ items: [item('a'), item('b')], total: 2 });
    const out = await featuredActivities({ limit: 8 });
    expect(out).toHaveLength(2);
    expect(searchActivities).toHaveBeenCalledTimes(1);
    expect(searchActivities.mock.calls[0]![1]).toMatchObject({ page: 1, pageSize: 8 });
  });

  it('never throws — a malformed catalogue response yields []', async () => {
    // A resolved-but-malformed payload makes the helper's destructuring throw INSIDE its try/catch,
    // exercising the catch path without a rejected promise (which trips vitest's unhandled detector).
    searchActivities.mockResolvedValue(null);
    await expect(featuredActivities({ category: 'X' })).resolves.toEqual([]);
  });
});
