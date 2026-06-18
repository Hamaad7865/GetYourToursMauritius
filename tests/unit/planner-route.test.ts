import { describe, expect, it } from 'vitest';
import { computePlannerRoute } from '@/lib/planner/route';

const pickup = { lat: -20.2, lng: 57.76 };
const dropoff = { lat: -20.0, lng: 57.5 };
const stops = [
  { lat: -20.16, lng: 57.5, durationMin: 60 },
  { lat: -20.1, lng: 57.58, durationMin: 90 },
];

describe('computePlannerRoute', () => {
  it('defaults to a round trip back to the pickup', () => {
    const r = computePlannerRoute(pickup, stops);
    // pickup→s1, s1→s2, s2→pickup
    expect(r.segs).toHaveLength(3);
    expect(r.segs[0]!.from).toEqual(pickup);
    expect(r.segs[r.segs.length - 1]!.to).toEqual(pickup);
    expect(r.visitMinutes).toBe(150);
  });

  it('ends at a distinct drop-off for a one-way day', () => {
    const r = computePlannerRoute(pickup, stops, dropoff);
    expect(r.segs).toHaveLength(3);
    expect(r.segs[0]!.from).toEqual(pickup);
    expect(r.segs[r.segs.length - 1]!.to).toEqual(dropoff);
  });

  it('a one-way route differs in distance from the round trip when the drop-off is elsewhere', () => {
    const round = computePlannerRoute(pickup, stops);
    const oneWay = computePlannerRoute(pickup, stops, dropoff);
    expect(oneWay.totalKm).not.toBeCloseTo(round.totalKm, 1);
    // Visit time is independent of the end point.
    expect(oneWay.visitMinutes).toBe(round.visitMinutes);
  });

  it('handles a no-stops day as pickup → end directly', () => {
    const r = computePlannerRoute(pickup, [], dropoff);
    expect(r.segs).toHaveLength(1);
    expect(r.segs[0]!.from).toEqual(pickup);
    expect(r.segs[0]!.to).toEqual(dropoff);
    expect(r.visitMinutes).toBe(0);
  });
});
