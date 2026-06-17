import { describe, expect, it } from 'vitest';
import { placeForStop, chosenRoute, divergesFromDefault } from '@/lib/itinerary/route';
import type { ItineraryStop } from '@/lib/validation/tours';

const STOPS: ItineraryStop[] = [
  { title: 'Port Louis', area: 'Capital' },
  {
    title: 'Pamplemousses',
    area: 'North',
    options: [{ title: 'Fort Adelaide', area: 'Port Louis' }],
  },
];

describe('per-stop selection', () => {
  it('placeForStop returns the primary for 0 / out-of-range, the alternative otherwise', () => {
    expect(placeForStop(STOPS[1]!, 0)).toEqual({
      title: 'Pamplemousses',
      area: 'North',
      lat: undefined,
      lng: undefined,
    });
    expect(placeForStop(STOPS[1]!, 1)).toEqual({
      title: 'Fort Adelaide',
      area: 'Port Louis',
      lat: undefined,
      lng: undefined,
    });
    expect(placeForStop(STOPS[1]!, 9).title).toBe('Pamplemousses'); // out of range → primary
    expect(placeForStop(STOPS[0]!, 1).title).toBe('Port Louis'); // no options → primary
  });

  it('chosenRoute maps each stop to its selected place, defaulting to primary', () => {
    expect(chosenRoute(STOPS, { 1: 1 }).map((p) => p.title)).toEqual(['Port Louis', 'Fort Adelaide']);
    expect(chosenRoute(STOPS, {}).map((p) => p.title)).toEqual(['Port Louis', 'Pamplemousses']);
  });

  it('divergesFromDefault is true only when some stop picks an alternative', () => {
    expect(divergesFromDefault({})).toBe(false);
    expect(divergesFromDefault({ 0: 0, 1: 0 })).toBe(false);
    expect(divergesFromDefault({ 1: 1 })).toBe(true);
  });
});
