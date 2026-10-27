'use client';

import {
  LINE_TYPES,
  PEOPLE_TYPES,
  WEEKDAYS,
  dayNumber,
  type CalLine,
} from '@/lib/admin/calendar-view';
import { LinePill } from './MonthGrid';
import { CalledOffTag, euros, Ic, ICON } from './parts';

export interface WeekDay {
  day: string;
  isToday: boolean;
  isPast: boolean;
  weekend: boolean;
  /** The day's lines that pass the filters. */
  lines: CalLine[];
  guests: number;
  valueEur: number;
}

export function WeekGrid({
  days,
  selected,
  showMoney,
  onOpenDay,
  onOpenLine,
}: {
  days: WeekDay[];
  selected: string | null;
  showMoney: boolean;
  onOpenDay: (day: string) => void;
  onOpenLine: (day: string, key: string) => void;
}) {
  return (
    // Seven columns need ~900px; beside a docked day panel that can be more than the page has, so
    // the week scrolls sideways inside its card rather than crushing the cards unreadable.
    <div className="overflow-hidden overflow-x-auto rounded-2xl border border-[#e3e9e8] bg-white shadow-[0_1px_2px_rgba(15,42,45,0.04)]">
      <div className="grid grid-cols-1 gap-px bg-[#e8eeed] lg:min-w-[896px] lg:grid-cols-7">
        {days.map((d, i) => (
          <WeekColumn
            key={d.day}
            d={d}
            index={i}
            selected={d.day === selected}
            showMoney={showMoney}
            onOpenDay={onOpenDay}
            onOpenLine={onOpenLine}
          />
        ))}
      </div>
    </div>
  );
}

function WeekColumn({
  d,
  index,
  selected,
  showMoney,
  onOpenDay,
  onOpenLine,
}: {
  d: WeekDay;
  index: number;
  selected: boolean;
  showMoney: boolean;
  onOpenDay: (day: string) => void;
  onOpenLine: (day: string, key: string) => void;
}) {
  const timed = d.lines.filter((l) => !l.allDay);
  const allDay = d.lines.filter((l) => l.allDay);
  const departures = timed.filter((l) => !l.cancelled && PEOPLE_TYPES.has(l.type)).length;
  return (
    <div
      className={`flex min-w-0 flex-col lg:min-h-[620px] ${d.weekend ? 'bg-[#fbfcfc]' : 'bg-white'}`}
    >
      <button
        type="button"
        onClick={() => onOpenDay(d.day)}
        aria-pressed={selected}
        className={`border-b border-[#e9eeed] px-3 pb-[11px] pt-3 text-left transition-colors hover:bg-[#f3f9f8] ${
          selected ? 'bg-[#eef7f6] shadow-[inset_0_-2px_0_rgb(var(--color-teal))]' : ''
        }`}
      >
        <span className="flex h-5 items-center gap-2">
          <span
            className={`text-[12px] font-bold uppercase tracking-[0.08em] ${
              d.isToday ? 'text-teal-dark' : 'text-ink-muted'
            }`}
          >
            {WEEKDAYS[index]!.slice(0, 3)}
          </span>
          {d.isToday && (
            <span className="ml-auto inline-flex h-5 items-center rounded-full bg-teal px-2 text-[11px] font-bold text-white">
              Today
            </span>
          )}
        </span>
        <span
          className={`mt-1 block text-[28px] font-extrabold leading-none tracking-[-0.02em] ${
            d.isPast ? 'text-ink-muted' : 'text-ink'
          }`}
        >
          {dayNumber(d.day)}
        </span>
        <span className="mt-2 block text-[12px] leading-[1.4] tabular-nums text-ink-muted">
          {departures
            ? `${departures} departure${departures === 1 ? '' : 's'} · ${d.guests} guest${d.guests === 1 ? '' : 's'}`
            : 'No departures'}
        </span>
        {showMoney && d.valueEur > 0 && (
          <span className="block text-[12px] leading-[1.4] tabular-nums text-ink-muted">
            {euros(d.valueEur)} booked
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 px-2 pb-3 pt-2.5">
        {timed.map((l) => (
          <WeekCard key={l.key} line={l} past={d.isPast} onOpen={() => onOpenLine(d.day, l.key)} />
        ))}
        {allDay.length > 0 && (
          <div className="mt-1 flex flex-col gap-1">
            <span className="px-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#6b7c7e]">
              All day
            </span>
            {allDay.map((l) => (
              <LinePill key={l.key} line={l} height={24} onOpen={() => onOpenLine(d.day, l.key)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WeekCard({ line, past, onOpen }: { line: CalLine; past: boolean; onOpen: () => void }) {
  const T = LINE_TYPES[line.type];
  const isFlight = line.type === 'transfer' && /lands|flight/i.test(line.where ?? '');
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-[5px] rounded-[10px] border border-[#e3e9e8] bg-white px-2.5 pb-2.5 pt-[9px] text-left transition hover:border-[#bfd3d1] hover:shadow-[0_8px_18px_-12px_rgba(15,42,45,0.4)]"
      style={{ opacity: line.cancelled ? 0.6 : past ? 0.78 : 1 }}
    >
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: T.dot }} />
        <span className="text-[12.5px] font-bold tabular-nums text-ink">{line.time ?? 'TBC'}</span>
        {PEOPLE_TYPES.has(line.type) && (
          <span className="ml-auto inline-flex items-center gap-[3px] text-[12px] font-semibold tabular-nums text-[#3c5255]">
            <Ic d={ICON.users} size={12} stroke={2.2} />
            {line.guests + line.pendingGuests}
          </span>
        )}
      </span>
      <span
        className={`line-clamp-2 text-[13px] font-semibold leading-[1.3] text-ink ${
          line.cancelled ? 'line-through' : ''
        }`}
      >
        {line.title}
      </span>
      {line.where && (
        <span
          className={`flex min-w-0 items-center gap-[5px] text-[12px] ${
            line.whereMissing && !past ? 'text-[#a15c07]' : 'text-ink-muted'
          }`}
        >
          <Ic d={isFlight ? ICON.plane : ICON.pin} size={12} className="shrink-0" />
          <span className="min-w-0 truncate">{line.where}</span>
        </span>
      )}
      {line.flags.length > 0 && (
        <span className="self-start rounded-md bg-[#fdf1de] px-[7px] py-0.5 text-[11.5px] font-semibold text-[#8f4c06]">
          {line.flags.join(' · ')}
        </span>
      )}
      {line.cancelled && (
        <span className="self-start">
          <CalledOffTag />
        </span>
      )}
    </button>
  );
}
