import { describe, expect, it, vi } from 'vitest';
import { resolveTourStops } from '@/lib/planner/from-tour';
import type { PlannerPlace } from '@/lib/validation/planner';

function place(id: string, name: string): PlannerPlace {
  return {
    id,
    name,
    category: 'Landmark',
    region: 'North',
    lat: -20,
    lng: 57.5,
    durationMin: 60,
    closesAt: null,
    blurb: null,
    imageUrl: null,
  };
}

describe('resolveTourStops', () => {
  it('resolves each stop and preserves itinerary order', async () => {
    const byTitle: Record<string, PlannerPlace> = {
      'Port Louis': place('p1', 'Port Louis'),
      'Pamplemousses Botanical Garden': place('p2', 'SSR Botanical Garden'),
      'Cap Malheureux': place('p3', 'Cap Malheureux'),
    };
    const searchOne = vi.fn(async (q: string) => byTitle[q] ?? null);

    const out = await resolveTourStops(
      [{ title: 'Port Louis' }, { title: 'Pamplemousses Botanical Garden' }, { title: 'Cap Malheureux' }],
      searchOne,
    );

    expect(out.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(searchOne).toHaveBeenCalledTimes(3);
  });

  it('skips stops that do not resolve', async () => {
    const searchOne = vi.fn(async (q: string) => (q === 'Grand Baie' ? place('g1', 'Grand Baie') : null));
    const out = await resolveTourStops([{ title: 'Nowhere' }, { title: 'Grand Baie' }], searchOne);
    expect(out.map((p) => p.id)).toEqual(['g1']);
  });

  it('drops duplicate resolutions, keeping the first occurrence', async () => {
    const dup = place('same', 'Central Market');
    const searchOne = vi.fn(async () => dup);
    const out = await resolveTourStops([{ title: 'Central Market' }, { title: 'Port Louis Market' }], searchOne);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('same');
  });

  it('treats a thrown lookup as an unresolved stop', async () => {
    const searchOne = vi.fn(async (q: string) => {
      if (q === 'Boom') throw new Error('places down');
      return place('ok', 'Le Morne');
    });
    const out = await resolveTourStops([{ title: 'Boom' }, { title: 'Le Morne' }], searchOne);
    expect(out.map((p) => p.id)).toEqual(['ok']);
  });
});
