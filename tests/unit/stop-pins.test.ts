import { describe, expect, it, vi } from 'vitest';
import { copyPinsByPosition, parseLatLng, pinItinerary } from '@/lib/admin/stop-pins';

type Opt = { title: string; area: string; lat?: number | null; lng?: number | null };
const stop = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  area: '',
  description: '',
  tags: [] as string[],
  options: [] as Opt[],
  ...extra,
});

describe('pinItinerary', () => {
  it('keeps a pin a stop already has (a hand-placed pin is never overwritten)', async () => {
    const request = vi.fn();
    const { stops } = await pinItinerary([stop('Port Louis', { lat: -20.1, lng: 57.4 })], request);
    expect(stops[0]).toMatchObject({ lat: -20.1, lng: 57.4 });
    expect(request).not.toHaveBeenCalled();
  });

  it('pins a stored name from the table with no network call', async () => {
    const request = vi.fn();
    const { stops, unpinned } = await pinItinerary([stop('Grand Baie')], request);
    expect(stops[0]).toMatchObject({ lat: -20.01302, lng: 57.58463 });
    expect(unpinned).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('asks the server once for every new stop and alternative, then applies the answers', async () => {
    const request = vi.fn(async () => ({
      'Brand New Stop': { lat: -20.3, lng: 57.6 },
      'New Alternative': null,
    }));
    const input = [
      { ...stop('Brand New Stop'), options: [{ title: 'New Alternative', area: '' }] },
    ];
    const { stops, unpinned } = await pinItinerary(input, request);
    expect(request).toHaveBeenCalledWith(['Brand New Stop', 'New Alternative']);
    expect(stops[0]).toMatchObject({ lat: -20.3, lng: 57.6 });
    expect(stops[0]!.options[0]).not.toHaveProperty('lat');
    expect(unpinned).toEqual(['New Alternative']);
  });

  it('never fails the save: a failed lookup leaves the stop unpinned and named', async () => {
    const request = vi.fn(async () => {
      throw new Error('down');
    });
    const { stops, unpinned } = await pinItinerary([stop('Brand New Stop')], request);
    expect(stops[0]).not.toHaveProperty('lat');
    expect(unpinned).toEqual(['Brand New Stop']);
  });

  it('does not report a generic phrase the table marks as "not a place"', async () => {
    const { unpinned } = await pinItinerary(
      [stop('Pick up and drop off at all parts of the island')],
      vi.fn(),
    );
    expect(unpinned).toEqual([]);
  });
});

describe('copyPinsByPosition', () => {
  const en = [
    stop('Port Louis', { lat: -20.16, lng: 57.5 }),
    stop('Ile aux Cerfs', { lat: -20.27, lng: 57.8 }),
  ];

  it('copies the English pins onto the French stops in the same position', () => {
    const fr = [{ title: 'Port-Louis' }, { title: 'Île aux Cerfs', lat: -1, lng: -1 }];
    expect(copyPinsByPosition(fr, en)).toEqual([
      { title: 'Port-Louis', lat: -20.16, lng: 57.5 },
      // a pin the French stop already has is left alone
      { title: 'Île aux Cerfs', lat: -1, lng: -1 },
    ]);
  });

  it('does nothing when the stop counts differ (positions cannot be trusted)', () => {
    expect(copyPinsByPosition([{ title: 'Port-Louis' }], en)).toBeNull();
  });

  it('returns null when nothing changed, so no write happens', () => {
    const fr = [
      { title: 'a', lat: 1, lng: 1 },
      { title: 'b', lat: 2, lng: 2 },
    ];
    expect(copyPinsByPosition(fr, en)).toBeNull();
    expect(copyPinsByPosition(undefined, en)).toBeNull();
  });
});

describe('parseLatLng', () => {
  it('reads what Google Maps copies on right-click', () => {
    expect(parseLatLng('-20.29163, 57.77963')).toEqual({ lat: -20.29163, lng: 57.77963 });
    expect(parseLatLng(' (-20.2916,57.7796) ')).toEqual({ lat: -20.2916, lng: 57.7796 });
  });

  it('rejects a swapped pair, a point off the island, and junk', () => {
    expect(parseLatLng('57.77963, -20.29163')).toBeNull();
    expect(parseLatLng('48.85, 2.35')).toBeNull();
    expect(parseLatLng('Port Louis')).toBeNull();
  });
});

describe('activityRow — stored pins survive a save', () => {
  it('writes a stop’s pin AND its alternatives’ pins into extra.itinerary', async () => {
    const { activityRow, EMPTY_ACTIVITY } = await import('@/lib/admin/activity-write');
    const row = activityRow({
      ...EMPTY_ACTIVITY,
      title: 'T',
      slug: 't',
      itinerary: [
        {
          ...stop('Port Louis', { lat: -20.16, lng: 57.5 }),
          options: [
            { title: 'Fort Adelaide', area: '', lat: -20.163, lng: 57.51 },
            { title: 'Unpinned', area: '', lat: null, lng: null },
          ],
        },
      ],
    });
    const extra = row.extra as unknown as {
      itinerary: Array<{ lat?: number; options: Array<Record<string, unknown>> }>;
    };
    expect(extra.itinerary[0]).toMatchObject({ lat: -20.16, lng: 57.5 });
    expect(extra.itinerary[0]!.options[0]).toMatchObject({ lat: -20.163, lng: 57.51 });
    expect(extra.itinerary[0]!.options[1]).not.toHaveProperty('lat');
  });
});
