import type { PlannerPlace } from '@/lib/validation/planner';
import type { StopNote } from './chat-history';

/**
 * "Compare my options": the day's stops laid side by side, one attribute per row.
 *
 * Pure so the rules that matter are testable without a browser: a row nobody has a value for is
 * left out entirely (an all-dashes "Closes" row teaches the visitor nothing), every cell is a fact
 * we actually hold — never a placeholder standing in for one — and a stop is only called the best
 * at something when the data says so unambiguously.
 */

/** One cell. Typed by what it holds so the table can render a rating as stars and a drive as a
 *  duration, rather than every cell arriving pre-flattened to a string. */
export type CompareCell =
  | { kind: 'text'; text: string }
  /** What the stop is and which part of the island it is in — our own short vocabulary, which the
   *  table translates (the free-text cells are ZilAi's or Google's words and are not). */
  | { kind: 'place'; category: string; region: string }
  | { kind: 'rating'; rating: number; count: number }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'drive'; minutes: number; km: number }
  | { kind: 'empty' };

export interface CompareRow {
  /** Stable id, also the English label the component translates. */
  label: string;
  cells: CompareCell[];
  /** Index of the one stop that leads this row, when exactly one does — see {@link soleLeader}. */
  best?: number;
  /** What leading this row is called, e.g. "Highest rated". Present with `best`. */
  bestLabel?: string;
}

const EMPTY: CompareCell = { kind: 'empty' };
const text = (value: string | null | undefined): CompareCell =>
  value && value.trim() ? { kind: 'text', text: value.trim() } : EMPTY;

/**
 * The index of the single highest score, or `undefined` when there is nothing to lead: fewer than
 * two stops have a score at all, or the top score is shared. "Highest rated" on the only rated stop,
 * or on one of two stops tied at 4.6, would be a badge the data does not support.
 */
function soleLeader(scores: Array<number | null>): number | undefined {
  const scored = scores.filter((s): s is number => s !== null);
  if (scored.length < 2) return undefined;
  const top = Math.max(...scored);
  return scored.filter((s) => s === top).length === 1 ? scores.indexOf(top) : undefined;
}

export function buildCompareRows(
  stops: PlannerPlace[],
  notes: ReadonlyMap<string, StopNote>,
  /** Drive legs aligned to `stops`: leg i is the drive TO stop i from the pick-up or the stop before. */
  legs: ReadonlyArray<{ minutes: number; km: number } | undefined>,
): CompareRow[] {
  const ratings = stops.map((p) =>
    typeof p.rating === 'number' && typeof p.ratingCount === 'number' && p.ratingCount > 0
      ? { rating: p.rating, count: p.ratingCount }
      : null,
  );
  const topRated = soleLeader(ratings.map((r) => r?.rating ?? null));

  const rows: CompareRow[] = [
    {
      label: 'Google rating',
      cells: ratings.map((r) => (r ? { kind: 'rating', ...r } : EMPTY)),
      ...(topRated !== undefined ? { best: topRated, bestLabel: 'Highest rated' } : {}),
    },
    {
      label: 'What it is',
      cells: stops.map((p) => ({ kind: 'place', category: p.category, region: p.region })),
    },
    {
      label: 'Time there',
      cells: stops.map((p) =>
        p.durationMin > 0 ? { kind: 'minutes', minutes: p.durationMin } : EMPTY,
      ),
    },
    { label: 'Closes', cells: stops.map((p) => text(p.closesAt)) },
    {
      label: 'Drive from previous stop',
      cells: stops.map((_, i) => {
        const leg = legs[i];
        return leg ? { kind: 'drive', minutes: leg.minutes, km: leg.km } : EMPTY;
      }),
    },
    // ZilAi's sentence when it wrote one, Google's own summary otherwise.
    { label: 'Why go', cells: stops.map((p) => text(notes.get(p.id)?.why ?? p.blurb)) },
    { label: 'Best when', cells: stops.map((p) => text(notes.get(p.id)?.tip)) },
  ];
  return rows.filter((row) => row.cells.some((cell) => cell.kind !== 'empty'));
}
