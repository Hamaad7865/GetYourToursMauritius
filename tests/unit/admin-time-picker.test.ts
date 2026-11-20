import { describe, expect, it } from 'vitest';
import { minuteOptions, parseTime } from '@/components/admin/TimePicker';

/**
 * The back-office TimePicker's two decisions that are not pixels: what counts as a time, and which
 * minutes it offers. A stored off-step minute must stay pickable, or re-opening a quote line timed
 * 09:36 would show a picker that cannot express the time the line already has.
 */
describe('TimePicker', () => {
  it('reads a native-style HH:MM value and refuses anything else', () => {
    expect(parseTime('09:36')).toEqual({ h: 9, m: 36 });
    expect(parseTime('23:55')).toEqual({ h: 23, m: 55 });
    expect(parseTime('')).toBeNull();
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('10:60')).toBeNull();
    expect(parseTime('soon')).toBeNull();
  });

  it('offers every 5 minutes, plus a stored minute that falls between steps', () => {
    expect(minuteOptions(5, null)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(minuteOptions(5, 35)).toHaveLength(12);
    const withOdd = minuteOptions(5, 36);
    expect(withOdd).toHaveLength(13);
    expect(withOdd.slice(7, 10)).toEqual([35, 36, 40]);
  });
});
