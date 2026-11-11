import { describe, expect, it, vi } from 'vitest';
import { osmPickupLabel, osmReverseName } from '@/lib/maps/osm-reverse';
import { nominatimSearch } from '@/lib/maps/osm-pin';

describe('osmPickupLabel — a dropped pin a driver can read when Google refuses', () => {
  it('names the hotel the pin is on (the real 9 Nov booking that showed bare coordinates)', () => {
    expect(
      osmPickupLabel({
        name: 'The Westin Turtle Bay Resort & Spa, Mauritius',
        address: {
          tourism: 'The Westin Turtle Bay Resort & Spa, Mauritius',
          road: 'B41',
          hamlet: 'Ville Valio',
        },
      }),
    ).toBe('The Westin Turtle Bay Resort & Spa, Mauritius, B41, Ville Valio');
  });

  it('uses the road and village when the spot has no name', () => {
    expect(osmPickupLabel({ address: { road: 'Coastal Road', village: 'Belle Mare' } })).toBe(
      'Coastal Road, Belle Mare',
    );
  });

  it('hedges a village-only answer, and gives up on nothing', () => {
    expect(osmPickupLabel({ address: { village: 'Belle Mare' } })).toBe('Near Belle Mare');
    expect(osmPickupLabel({ address: {} })).toBeNull();
    expect(osmPickupLabel(null)).toBeNull();
  });

  it('drops parts the voucher PDF cannot print', () => {
    expect(osmPickupLabel({ name: 'Отель', address: { road: 'Coastal Road' } })).toBe(
      'Coastal Road',
    );
  });

  it('never throws on a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await osmReverseName(-20.1, 57.5, fetchImpl as unknown as typeof fetch)).toBeNull();
  });
});

describe('nominatimSearch — the pick-up box fallback', () => {
  it('maps OSM hits to name/area/coords and keeps only on-island results', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              lat: '-20.2091',
              lon: '57.7891',
              name: 'Radisson',
              type: 'hotel',
              address: { village: 'Belle Mare' },
            },
            { lat: '-19.7', lon: '63.4', name: 'Somewhere on Rodrigues' },
          ]),
        ),
    );
    expect(await nominatimSearch('radisson', fetchImpl as unknown as typeof fetch)).toEqual([
      { name: 'Radisson', area: 'Belle Mare', kind: 'hotel', lat: -20.2091, lng: 57.7891 },
    ]);
  });
});
