import { describe, expect, it } from 'vitest';
import {
  availableToClosedWeekdays,
  closedWeekdaysToAvailable,
  WEEKDAY_LABELS,
} from '@/lib/admin/option-weekdays';

/** The "Runs on" control shows AVAILABLE days (Mon…Sun, checked = runs); storage is the OFF days as
 *  ISO weekday numbers (Mon=1 … Sun=7). These two pure maps are the only glue between them. */
describe('option weekday mapping', () => {
  it('labels are Monday-first and complete', () => {
    expect([...WEEKDAY_LABELS]).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('availableToClosedWeekdays: every day on → nothing closed', () => {
    expect(availableToClosedWeekdays([true, true, true, true, true, true, true])).toEqual([]);
  });

  it('availableToClosedWeekdays: sunset catamaran (Sun + Mon off) → {1,7}, ascending', () => {
    // index 0 = Mon (ISO 1), index 6 = Sun (ISO 7)
    const days = [false, true, true, true, true, true, false];
    expect(availableToClosedWeekdays(days)).toEqual([1, 7]);
  });

  it('availableToClosedWeekdays: all off → every ISO weekday', () => {
    expect(availableToClosedWeekdays([false, false, false, false, false, false, false])).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('closedWeekdaysToAvailable: empty/nullish → all seven on', () => {
    const allOn = [true, true, true, true, true, true, true];
    expect(closedWeekdaysToAvailable([])).toEqual(allOn);
    expect(closedWeekdaysToAvailable(null)).toEqual(allOn);
    expect(closedWeekdaysToAvailable(undefined)).toEqual(allOn);
  });

  it('closedWeekdaysToAvailable: {1,7} → Mon & Sun off, midweek on', () => {
    expect(closedWeekdaysToAvailable([1, 7])).toEqual([false, true, true, true, true, true, false]);
  });

  it('round-trips any closed set (order-independent)', () => {
    for (const closed of [[], [3], [1, 7], [2, 4, 6], [1, 2, 3, 4, 5, 6, 7], [7, 1]]) {
      const back = availableToClosedWeekdays(closedWeekdaysToAvailable(closed));
      expect(back).toEqual([...closed].sort((a, b) => a - b));
    }
  });
});
