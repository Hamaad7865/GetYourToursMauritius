import { describe, expect, it } from 'vitest';
import { parseStopsParam, stopsToParam } from '@/lib/planner/share';

const VALID = ['grand-baie-beach', 'chamarel-waterfall', 'le-morne-brabant'];

describe('parseStopsParam', () => {
  it('returns [] for empty / missing input', () => {
    expect(parseStopsParam(null, VALID)).toEqual([]);
    expect(parseStopsParam(undefined, VALID)).toEqual([]);
    expect(parseStopsParam('', VALID)).toEqual([]);
    expect(parseStopsParam('   ', VALID)).toEqual([]);
  });

  it('keeps only known ids, in the given order', () => {
    expect(parseStopsParam('le-morne-brabant,grand-baie-beach', VALID)).toEqual([
      'le-morne-brabant',
      'grand-baie-beach',
    ]);
  });

  it('drops unknown ids (a stale or hand-edited link cannot inject places)', () => {
    expect(parseStopsParam('grand-baie-beach,not-a-place,chamarel-waterfall', VALID)).toEqual([
      'grand-baie-beach',
      'chamarel-waterfall',
    ]);
  });

  it('trims whitespace and de-duplicates while preserving first position', () => {
    expect(
      parseStopsParam(' grand-baie-beach , chamarel-waterfall ,grand-baie-beach', VALID),
    ).toEqual(['grand-baie-beach', 'chamarel-waterfall']);
  });
});

describe('stopsToParam', () => {
  it('round-trips with parseStopsParam', () => {
    const ids = ['chamarel-waterfall', 'le-morne-brabant'];
    expect(parseStopsParam(stopsToParam(ids), VALID)).toEqual(ids);
  });

  it('joins ids with commas', () => {
    expect(stopsToParam(['a', 'b', 'c'])).toBe('a,b,c');
    expect(stopsToParam([])).toBe('');
  });
});
