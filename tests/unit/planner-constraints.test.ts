import { describe, expect, it } from 'vitest';
import {
  MAX_STOPS,
  canAddStop,
  isRegionCompatible,
  dayRegionLabel,
  addBlockReason,
  filterItinerary,
} from '@/lib/planner/constraints';

/**
 * The planner day guardrails: a hard 6-stop cap and a "block only far regions" rule. The only far
 * region pairs are North↔South and East↔West (everything else is same/near), reusing the app's
 * regionDistanceBand model. These pure helpers gate every add path (UI + AI co-pilot).
 */
const r = (id: string, region: string | null) => ({ id, region });

describe('canAddStop', () => {
  it('allows up to the cap and blocks at it', () => {
    expect(MAX_STOPS).toBe(6);
    expect(canAddStop(0)).toBe(true);
    expect(canAddStop(5)).toBe(true);
    expect(canAddStop(6)).toBe(false);
    expect(canAddStop(7)).toBe(false);
  });
});

describe('isRegionCompatible', () => {
  it('allows any region on an empty day', () => {
    expect(isRegionCompatible('North', [])).toBe(true);
  });
  it('blocks far pairs and allows same/near', () => {
    expect(isRegionCompatible('North', ['South'])).toBe(false); // far
    expect(isRegionCompatible('South', ['South'])).toBe(true); // same
    expect(isRegionCompatible('East', ['South'])).toBe(true); // near
    expect(isRegionCompatible('West', ['South'])).toBe(true); // near
    expect(isRegionCompatible('Central', ['South'])).toBe(true); // near
    expect(isRegionCompatible('West', ['East'])).toBe(false); // far
  });
  it('checks against every region already in the day (all-pairs)', () => {
    expect(isRegionCompatible('West', ['South', 'East'])).toBe(false); // far from East
    expect(isRegionCompatible('Central', ['South', 'East'])).toBe(true);
  });
  it('treats a null region as incompatible (fail-safe)', () => {
    expect(isRegionCompatible(null, ['South'])).toBe(false);
    expect(isRegionCompatible('South', [null])).toBe(false);
  });
});

describe('dayRegionLabel', () => {
  it('returns the most common region, ignoring nulls; null for an empty day', () => {
    expect(dayRegionLabel(['South', 'South', 'East'])).toBe('South');
    expect(dayRegionLabel([null, 'East', null])).toBe('East');
    expect(dayRegionLabel([])).toBeNull();
  });
});

describe('addBlockReason', () => {
  it('returns "full" at the cap (precedence over region)', () => {
    expect(addBlockReason('North', ['South', 'South', 'South', 'South', 'South', 'South'])).toBe(
      'full',
    );
  });
  it('returns "far-region" when incompatible and there is room', () => {
    expect(addBlockReason('North', ['South'])).toBe('far-region');
  });
  it('returns null when the add is allowed', () => {
    expect(addBlockReason('East', ['South'])).toBeNull();
    expect(addBlockReason('North', [])).toBeNull();
  });
});

describe('filterItinerary', () => {
  it('keeps same/near stops in order and rejects far ones', () => {
    const res = filterItinerary([r('a', 'South'), r('b', 'East'), r('c', 'North')], []);
    expect(res.accepted.map((x) => x.id)).toEqual(['a', 'b']);
    expect(res.rejectedFarRegion.map((x) => x.id)).toEqual(['c']); // North far from South
  });
  it('rejects a far addition while keeping the existing day (present in the proposed list)', () => {
    const res = filterItinerary([r('s1', 'South'), r('n1', 'North')], [r('s1', 'South')]);
    expect(res.accepted.map((x) => x.id)).toEqual(['s1']);
    expect(res.rejectedFarRegion.map((x) => x.id)).toEqual(['n1']);
  });
  it('yields empty accepted when the model proposes only a far place (caller then keeps the day)', () => {
    const res = filterItinerary([r('n1', 'North')], [r('s1', 'South')]);
    expect(res.accepted).toEqual([]);
    expect(res.rejectedFarRegion.map((x) => x.id)).toEqual(['n1']);
  });
  it('honours a removal (existing stop omitted from the proposed list is gone)', () => {
    const res = filterItinerary([r('s1', 'South')], [r('s1', 'South'), r('s2', 'South')]);
    expect(res.accepted.map((x) => x.id)).toEqual(['s1']);
  });
  it('drops stops over the 6 cap', () => {
    const seven = Array.from({ length: 7 }, (_, i) => r(`p${i}`, 'South'));
    const res = filterItinerary(seven, []);
    expect(res.accepted).toHaveLength(6);
    expect(res.droppedOverCap.map((x) => x.id)).toEqual(['p6']);
  });
  it('dedupes ids that appear more than once', () => {
    const res = filterItinerary([r('a', 'South'), r('a', 'South')], []);
    expect(res.accepted.map((x) => x.id)).toEqual(['a']);
  });
});
