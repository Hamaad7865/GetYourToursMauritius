'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { TODAY_LIFT } from '@/components/admin/today/MetricCard';
import { Panel, ProgressBar, StatusChip, buttonClass, AdminLoading } from '@/components/admin/ui';
import { PrintRunSheetButton } from '@/components/admin/RunSheetPrint';
import { shortDay } from '@/lib/admin/calendar-view';
import type { DayEntry } from '@/lib/admin/calendar';
import { IconCalendar } from '@/components/ui/icons';
import {
  tomorrowLine,
  type DaySummary,
  type Loaded,
  type QuietDays,
  type RunRow,
} from '@/components/admin/today/rules';

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One departure on the run sheet: time · what · how full · pickups · its chip. A row from later in
 *  the week carries its day above the time. */
function RunSheetRow({
  row,
  href,
  withDay,
}: {
  row: RunRow;
  href: string | null;
  withDay: boolean;
}) {
  const time = row.allDay ? 'All day' : (row.time ?? 'Time TBC');
  const guests =
    row.guests > 0 || row.pendingGuests > 0
      ? `${plural(row.guests, 'guest')}${row.pendingGuests ? ` +${row.pendingGuests} unpaid` : ''}`
      : null;
  const title = (
    <>
      <span className="block truncate font-bold text-ink">{row.title}</span>
      <span className="block truncate text-[12px] text-ink-soft">
        {[row.subtitle, guests].filter(Boolean).join(' · ') || ' '}
      </span>
    </>
  );
  // Every cell is placed in both layouts. On a phone: the time, then the tour with its chip, how
  // full and the pickups stacked under it. Wider: one line, chip last. (A row-only placement once
  // let the grid put the chip outside its row on a wide screen.)
  const cols = withDay
    ? 'grid-cols-[76px_minmax(0,1fr)] sm:grid-cols-[76px_minmax(0,1fr)_116px_96px_auto]'
    : 'grid-cols-[52px_minmax(0,1fr)] sm:grid-cols-[52px_minmax(0,1fr)_116px_96px_auto]';
  return (
    <li
      className={`grid items-center gap-x-3 gap-y-1.5 border-b border-line-soft px-4 py-[11px] last:border-b-0 ${cols}`}
    >
      <span
        className={`col-start-1 row-start-1 text-[13px] font-bold tabular-nums ${row.time ? 'text-ink' : 'text-[11.5px] text-ink-soft'}`}
        title={row.time || row.allDay ? undefined : 'No start time set on this tour'}
      >
        {withDay && (
          <span className="block text-[11.5px] font-semibold text-ink-muted">
            {shortDay(row.day)}
          </span>
        )}
        {time}
      </span>
      <span
        className={`col-start-2 row-start-1 min-w-0 ${row.cancelled ? 'line-through decoration-ink-soft' : ''}`}
      >
        {href ? (
          <Link
            href={href}
            className="block rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-dark"
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </span>
      <span className="col-start-2 row-start-3 min-w-0 empty:hidden sm:col-start-3 sm:row-start-1">
        {row.capacity ? (
          <>
            <span className="block text-[12px] text-ink-soft">{row.capacity.label} booked</span>
            <ProgressBar
              value={row.capacity.used}
              max={row.capacity.max}
              tone={row.capacity.used >= row.capacity.max ? 'gold' : 'teal'}
              label={`${row.capacity.label} booked`}
              className="mt-1"
            />
          </>
        ) : null}
      </span>
      <span className="col-start-2 row-start-4 text-[12px] text-ink-soft empty:hidden sm:col-start-4 sm:row-start-1">
        {row.pickups > 0 ? plural(row.pickups, 'pickup') : null}
      </span>
      <span className="col-start-2 row-start-2 justify-self-start sm:col-start-5 sm:row-start-1 sm:justify-self-end">
        <StatusChip tone={row.chip.tone}>{row.chip.label}</StatusChip>
      </span>
    </li>
  );
}

function RowList({
  rows,
  calendarHref,
  withDay = false,
  afterStrip = false,
}: {
  rows: RunRow[];
  calendarHref: ((row: RunRow) => string) | null;
  withDay?: boolean;
  afterStrip?: boolean;
}) {
  return (
    <ul className={afterStrip ? 'border-t border-line-soft' : undefined}>
      {rows.map((r) => (
        <RunSheetRow
          key={`${r.day}-${r.key}`}
          row={r}
          href={calendarHref ? calendarHref(r) : null}
          withDay={withDay}
        />
      ))}
    </ul>
  );
}

/** A grey strip naming what follows ("Tomorrow", "Later this week"), with its own link. */
function Strip({
  heading,
  line,
  link,
}: {
  heading: string;
  line: string | null;
  link: { href: string; label: string } | null;
}) {
  return (
    <div className="flex min-h-[40px] flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line-soft bg-[#FAFBFB] px-4 py-2">
      <h3 className="text-[13px] font-bold text-ink">{heading}</h3>
      {line && <span className="text-[12px] text-ink-soft">{line}</span>}
      {link && (
        <Link
          href={link.href}
          className="ml-auto text-[12px] font-semibold text-teal-dark hover:underline"
        >
          {link.label}
        </Link>
      )}
    </div>
  );
}

/**
 * Today's run sheet, then a look at tomorrow — the Calendar's day sheet in short, from the Calendar's
 * own read. Each row opens that line on the Calendar for someone with the Calendar.
 *
 * A quiet day takes one line, not an empty box: today empty says so; today AND tomorrow empty fold
 * into one sentence and the next departures later in the week stand in their place (`quietDays`).
 */
export function RunSheetCard({
  today,
  tomorrow,
  entries,
  todayRows,
  tomorrowRows,
  tomorrowSummary,
  quiet,
  showCalendar,
  showMoney,
}: {
  today: string;
  tomorrow: string;
  /** The day-sheet entries for today and the rest of the week, as loaded. */
  entries: Loaded<DayEntry[]>;
  todayRows: RunRow[];
  tomorrowRows: RunRow[];
  tomorrowSummary: DaySummary | null;
  quiet: QuietDays | null;
  showCalendar: boolean;
  showMoney: boolean;
}) {
  const ready = entries !== null && entries !== 'error';
  const lineHref = showCalendar
    ? (r: RunRow) => `/admin/calendar?day=${r.day}&line=${encodeURIComponent(r.key)}`
    : null;
  const bothQuiet = ready && todayRows.length === 0 && tomorrowRows.length === 0;
  return (
    <Panel
      title="Today’s run sheet"
      meta={shortDay(today)}
      className={TODAY_LIFT}
      style={{ '--i': 5 } as CSSProperties}
      actions={
        <>
          {showCalendar && (
            <Link href={`/admin/calendar?day=${today}`} className={buttonClass('ghost', 'sm')}>
              Open day sheet
            </Link>
          )}
          {/* Nothing to print on a day with no departures. */}
          {(!ready || todayRows.length > 0) && (
            <PrintRunSheetButton
              entries={ready ? entries : null}
              day={today}
              today={today}
              showMoney={showMoney}
              label="Print"
            />
          )}
        </>
      }
    >
      {entries === 'error' ? (
        <p role="alert" className="px-4 py-6 text-center text-coral-dark">
          Could not load today’s departures. The rest of this page still works; try reloading.
        </p>
      ) : entries === null ? (
        <AdminLoading className="px-4 py-6 text-center" />
      ) : (
        <>
          {todayRows.length > 0 ? (
            <RowList rows={todayRows} calendarHref={lineHref} />
          ) : (
            <p className="flex items-center gap-2.5 px-4 py-3.5 text-ink-muted">
              <span
                aria-hidden="true"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-tint text-teal-dark"
              >
                <IconCalendar width={16} height={16} />
              </span>
              {quiet?.message ?? 'No departures today.'}
            </p>
          )}

          {bothQuiet ? (
            quiet && quiet.later.length > 0 ? (
              <>
                <Strip
                  heading="Later this week"
                  line={
                    quiet.moreLater > 0
                      ? `The next ${quiet.later.length}, and ${quiet.moreLater} more`
                      : null
                  }
                  link={showCalendar ? { href: '/admin/calendar', label: 'Open calendar' } : null}
                />
                <RowList rows={quiet.later} calendarHref={lineHref} withDay afterStrip />
              </>
            ) : null
          ) : (
            <>
              <Strip
                heading="Tomorrow"
                line={
                  tomorrowRows.length === 0
                    ? `${shortDay(tomorrow)}, nothing booked yet`
                    : tomorrowSummary
                      ? tomorrowLine(tomorrowSummary, tomorrow)
                      : null
                }
                link={
                  showCalendar && tomorrowRows.length > 0
                    ? { href: `/admin/calendar?day=${tomorrow}`, label: 'Open tomorrow' }
                    : null
                }
              />
              {tomorrowRows.length > 0 && (
                <RowList rows={tomorrowRows} calendarHref={lineHref} afterStrip />
              )}
            </>
          )}
        </>
      )}
    </Panel>
  );
}
