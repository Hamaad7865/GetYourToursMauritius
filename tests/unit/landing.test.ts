import { describe, expect, it, beforeEach, vi } from 'vitest';

// vi.hoisted so the controllable mock fn exists before the hoisted vi.mock factory references it.
const { searchActivities } = vi.hoisted(() => ({ searchActivities: vi.fn() }));
vi.mock('@/lib/services/activities', () => ({ searchActivities }));
vi.mock('@/lib/http/context', () => ({ publicServiceContext: () => ({}) }));

const { featuredActivities, belleMareActivityGroups } = await import('@/lib/seo/landing');

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

describe('belleMareActivityGroups', () => {
  it('buckets East boat/cruise categories into "Boat trips & Île aux Cerfs"', async () => {
    searchActivities
      .mockResolvedValueOnce({
        items: [
          { slug: 'catamaran-east', category: 'Catamaran cruises' },
          { slug: 'speedboat-east', category: 'Speedboat Tours' },
        ],
        total: 2,
      }) // region: East
      .mockResolvedValueOnce({ items: [], total: 0 }); // category: Taxi Sightseeing tours
    const groups = await belleMareActivityGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('Boat trips & Île aux Cerfs');
    expect(groups[0]!.activities).toHaveLength(2);
    expect(searchActivities.mock.calls[0]![1]).toMatchObject({ region: 'East' });
    expect(searchActivities.mock.calls[1]![1]).toMatchObject({ category: 'Taxi Sightseeing tours' });
  });

  it('always includes Taxi Sightseeing tours as its own group, regardless of region', async () => {
    searchActivities
      .mockResolvedValueOnce({ items: [], total: 0 }) // region: East — none
      .mockResolvedValueOnce({
        items: [{ slug: 'south-tour', category: 'Taxi Sightseeing tours' }],
        total: 1,
      });
    const groups = await belleMareActivityGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('Sightseeing & day tours');
    expect(groups[0]!.activities).toHaveLength(1);
  });

  it('puts an East activity outside the named categories into the "More ways to explore" catch-all', async () => {
    searchActivities
      .mockResolvedValueOnce({
        items: [{ slug: 'hiking-east', category: 'Hiking & Land Adventures' }],
        total: 1,
      })
      .mockResolvedValueOnce({ items: [], total: 0 });
    const groups = await belleMareActivityGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('More ways to explore');
  });

  it('omits every group when nothing matches (no blank sections)', async () => {
    searchActivities.mockResolvedValue({ items: [], total: 0 });
    const groups = await belleMareActivityGroups();
    expect(groups).toEqual([]);
  });

  it('never throws — a malformed catalogue response yields no groups', async () => {
    searchActivities.mockResolvedValue(null);
    await expect(belleMareActivityGroups()).resolves.toEqual([]);
  });
});
