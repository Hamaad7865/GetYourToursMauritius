'use client';

import { useMemo } from 'react';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { StopNote } from '@/lib/planner/chat-history';
import { buildCompareRows, type CompareCell, type CompareRow } from '@/lib/planner/compare';
import { usePreferences } from '@/components/site/PreferencesProvider';
import { IconHeart } from '@/components/ui/icons';
import { fmtDur } from '../planner-constants';
import { StarRating } from './StarRating';
import { StopPhoto } from './StopCard';

/** Narrowest a stop's column gets before the table scrolls sideways instead of squeezing. */
const COLUMN_MIN = 232;
const LABEL_WIDTH = 150;

/**
 * "Compare my options": the day's stops side by side, to decide which to keep.
 *
 * Each stop is a column headed by its photo; each row is one fact about all of them, and where one
 * stop clearly leads a row it says so. The heart at the top of a column keeps that stop through
 * "Regenerate unpinned"; "Remove" at the bottom drops it — the two things a comparison is for.
 *
 * A real <table>, because it IS tabular data and a screen reader should be able to walk it by row
 * and column. The canvas gives it the map's space too while it is showing (see zilai.css), and on a
 * narrow list the row labels move inside the cells so a column still reads on its own.
 */
export function CompareTable({
  stops,
  notes,
  legs,
  pinnedIds,
  busy,
  onTogglePin,
  onRemove,
}: {
  stops: PlannerPlace[];
  notes: ReadonlyMap<string, StopNote>;
  legs: ReadonlyArray<{ minutes: number; km: number } | undefined>;
  pinnedIds: ReadonlySet<string>;
  /** ZilAi is changing the plan — removing waits. */
  busy: boolean;
  onTogglePin: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = usePreferences();
  const rows = useMemo(() => buildCompareRows(stops, notes, legs), [stops, notes, legs]);

  const cell = (c: CompareCell, row: CompareRow, column: number) => {
    switch (c.kind) {
      case 'text':
        return row.label === 'Best when' ? (
          <span
            className="zilai-mark font-semibold"
            style={{ '--i': column } as React.CSSProperties}
          >
            {c.text}
          </span>
        ) : (
          c.text
        );
      case 'place':
        return `${t(c.category)} · ${t(c.region)}`;
      case 'rating':
        return <StarRating rating={c.rating} count={c.count} source="google" size={13} />;
      case 'minutes':
        return fmtDur(c.minutes);
      case 'drive':
        return t('{m} min · {km} km', { m: c.minutes, km: c.km });
      default:
        // Nothing known is shown as nothing known — read out as such, not as a stray dash.
        return (
          <span className="text-ink-muted">
            <span aria-hidden>—</span>
            <span className="sr-only">{t('Not available')}</span>
          </span>
        );
    }
  };

  return (
    <div className="zilai-view zilai-compare zilai-scroll zilai-scroll-x -mx-5 overflow-x-auto px-5 pb-2 lg:-mx-8 lg:px-8">
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-left text-[14.5px] text-ink"
        style={{ minWidth: LABEL_WIDTH + stops.length * COLUMN_MIN }}
      >
        <caption className="sr-only">{t('Your stops compared side by side')}</caption>
        <colgroup>
          <col className="zilai-compare-label" style={{ width: LABEL_WIDTH }} />
          {stops.map((p) => (
            <col key={p.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td className="zilai-compare-label sticky left-0 z-10 bg-white" />
            {stops.map((p, i) => {
              const pinned = pinnedIds.has(p.id);
              return (
                <th
                  key={p.id}
                  scope="col"
                  className="zilai-card px-2.5 pb-3 align-top font-normal"
                  style={{ '--i': i } as React.CSSProperties}
                >
                  <div className="relative">
                    <StopPhoto
                      place={p}
                      src={p.imageUrl}
                      className="aspect-[16/10] w-full rounded-xl"
                    />
                    <span
                      aria-hidden
                      className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-teal-dark text-[13px] font-extrabold tabular-nums text-white shadow-[0_2px_8px_rgba(10,46,54,0.3)]"
                    >
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => onTogglePin(p.id)}
                      aria-pressed={pinned}
                      aria-label={
                        pinned
                          ? t('Stop keeping {name}', { name: p.name })
                          : t('Keep {name} when the plan is regenerated', { name: p.name })
                      }
                      title={pinned ? t('Kept — stays when you regenerate') : t('Keep this stop')}
                      className={`zilai-heart absolute right-2 top-2 grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-white shadow-[0_2px_10px_rgba(10,46,54,0.22)] transition-colors ${
                        pinned ? 'text-coral-dark' : 'text-ink hover:text-coral-dark'
                      }`}
                    >
                      <IconHeart width={19} height={19} fill={pinned ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <div className="mt-2.5 text-[16.5px] font-extrabold leading-snug tracking-[-0.01em]">
                    <span className="sr-only">{i + 1}. </span>
                    {p.name}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th
                scope="row"
                className="zilai-compare-label sticky left-0 z-10 border-t border-ink/10 bg-white py-3.5 pr-4 align-top text-[13px] font-bold leading-[1.45] text-ink-muted"
              >
                {t(row.label)}
              </th>
              {row.cells.map((c, i) => {
                const leads = row.best === i && row.bestLabel;
                return (
                  <td
                    key={stops[i]!.id}
                    data-label={t(row.label)}
                    className="border-t border-ink/10 px-2.5 py-3.5 align-top leading-[1.5]"
                  >
                    {cell(c, row, i)}
                    {leads && (
                      <span className="mt-1.5 block w-fit rounded-full bg-teal-tint px-2.5 py-0.5 text-[12px] font-bold text-teal-dark">
                        {t(row.bestLabel!)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th
              scope="row"
              className="zilai-compare-label sticky left-0 z-10 border-t border-ink/10 bg-white"
            >
              <span className="sr-only">{t('Remove a stop')}</span>
            </th>
            {stops.map((p) => (
              <td key={p.id} className="border-t border-ink/10 px-2.5 py-3 align-top">
                <button
                  type="button"
                  onClick={() => onRemove(p.id)}
                  disabled={busy}
                  aria-label={t('Remove {name} from the day', { name: p.name })}
                  className="cursor-pointer rounded-full border border-ink/25 px-3.5 py-1.5 text-[13.5px] font-bold text-ink transition-colors hover:border-coral-dark hover:text-coral-dark disabled:cursor-default disabled:opacity-40"
                >
                  {t('Remove')}
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
