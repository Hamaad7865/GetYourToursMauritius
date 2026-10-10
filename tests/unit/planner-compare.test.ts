import { describe, expect, it } from 'vitest';
import { buildCompareRows } from '@/lib/planner/compare';
import type { StopNote } from '@/lib/planner/chat-history';
import type { PlannerPlace } from '@/lib/validation/planner';

/* "Compare my options" is a table of facts. These pin the two rules that keep it honest: a row
 * nobody has a value for is left out, and a cell is only ever filled from data we actually hold. */

const place = (id: string, over: Partial<PlannerPlace> = {}): PlannerPlace => ({
  id,
  name: `Place ${id}`,
  category: 'Beach',
  region: 'South',
  lat: -20.4,
  lng: 57.6,
  durationMin: 120,
  closesAt: null,
  blurb: null,
  imageUrl: null,
  ...over,
});

const labels = (rows: ReturnType<typeof buildCompareRows>) => rows.map((r) => r.label);

describe('buildCompareRows', () => {
  it('lays each stop out as one cell per row, in stop order', () => {
    const stops = [place('a'), place('b', { category: 'Waterfall', durationMin: 60 })];
    const rows = buildCompareRows(stops, new Map(), [
      { minutes: 40, km: 22 },
      { minutes: 11, km: 7 },
    ]);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.cells]));
    expect(byLabel['What it is']).toEqual([
      { kind: 'place', category: 'Beach', region: 'South' },
      { kind: 'place', category: 'Waterfall', region: 'South' },
    ]);
    expect(byLabel['Time there']).toEqual([
      { kind: 'minutes', minutes: 120 },
      { kind: 'minutes', minutes: 60 },
    ]);
    expect(byLabel['Drive from previous stop']).toEqual([
      { kind: 'drive', minutes: 40, km: 22 },
      { kind: 'drive', minutes: 11, km: 7 },
    ]);
  });

  it('drops a row that no stop has a value for — an all-dashes row teaches nothing', () => {
    // No ratings, no closing times, no card text, no Google summaries, no legs.
    const rows = buildCompareRows([place('a'), place('b')], new Map(), []);
    expect(labels(rows)).toEqual(['What it is', 'Time there']);
  });

  it('keeps a row as soon as ONE stop has a value, and marks the others empty', () => {
    const stops = [place('a', { closesAt: '17:00' }), place('b')];
    const closes = buildCompareRows(stops, new Map(), []).find((r) => r.label === 'Closes')!;
    expect(closes.cells).toEqual([{ kind: 'text', text: '17:00' }, { kind: 'empty' }]);
  });

  it('shows a Google rating only with the review count behind it', () => {
    const stops = [
      place('a', { rating: 4.5, ratingCount: 934 }),
      place('b', { rating: 4.9 }), // a rating with no count is not a rating we can show
      place('c', { rating: 0, ratingCount: 0 }),
    ];
    const row = buildCompareRows(stops, new Map(), []).find((r) => r.label === 'Google rating')!;
    expect(row.cells).toEqual([
      { kind: 'rating', rating: 4.5, count: 934 },
      { kind: 'empty' },
      { kind: 'empty' },
    ]);
  });

  it('names the highest-rated stop only when exactly one leads', () => {
    const rate = (stops: PlannerPlace[]) =>
      buildCompareRows(stops, new Map(), []).find((r) => r.label === 'Google rating')!;

    const clear = rate([
      place('a', { rating: 4.4, ratingCount: 2117 }),
      place('b', { rating: 4.7, ratingCount: 1913 }),
      place('c'),
    ]);
    expect(clear.best).toBe(1);
    expect(clear.bestLabel).toBe('Highest rated');

    // A tie at the top has no leader — picking one would be a badge the data does not support.
    const tied = rate([
      place('a', { rating: 4.6, ratingCount: 10 }),
      place('b', { rating: 4.6, ratingCount: 900 }),
    ]);
    expect(tied.best).toBeUndefined();
    expect(tied.bestLabel).toBeUndefined();

    // The only rated stop is not "the highest rated" of anything.
    const alone = rate([place('a', { rating: 4.9, ratingCount: 40 }), place('b')]);
    expect(alone.best).toBeUndefined();
  });

  it('marks no leader on rows where "best" would be meaningless', () => {
    const rows = buildCompareRows(
      [place('a', { durationMin: 30 }), place('b', { durationMin: 180 })],
      new Map(),
      [
        { minutes: 5, km: 2 },
        { minutes: 60, km: 40 },
      ],
    );
    // A short drive belongs to the ORDER of the day, not to the place; a short visit is not a merit.
    for (const row of rows) expect(row.best, row.label).toBeUndefined();
  });

  it('prefers ZilAi’s sentence and falls back to Google’s summary, never inventing one', () => {
    const stops = [
      place('a', { blurb: 'Google says: a quiet cove.' }),
      place('b', { blurb: 'Google says: a market.' }),
      place('c'),
    ];
    const notes = new Map<string, StopNote>([
      ['a', { why: 'Calm water behind the reef.', tip: 'Best before 10am.' }],
    ]);
    const rows = buildCompareRows(stops, notes, []);
    expect(rows.find((r) => r.label === 'Why go')!.cells).toEqual([
      { kind: 'text', text: 'Calm water behind the reef.' },
      { kind: 'text', text: 'Google says: a market.' },
      { kind: 'empty' },
    ]);
    expect(rows.find((r) => r.label === 'Best when')!.cells).toEqual([
      { kind: 'text', text: 'Best before 10am.' },
      { kind: 'empty' },
      { kind: 'empty' },
    ]);
  });

  it('treats whitespace as nothing', () => {
    const rows = buildCompareRows([place('a', { blurb: '   ' })], new Map(), []);
    expect(labels(rows)).not.toContain('Why go');
  });
});
