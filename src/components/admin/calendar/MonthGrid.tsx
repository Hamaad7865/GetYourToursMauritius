'use client';

import {
  LINE_TYPES,
  MONTHS,
  PEOPLE_TYPES,
  WEEKDAYS,
  dayNumber,
  shortDay,
  yearMonth,
  type CalLine,
  type MonthCell,
} from '@/lib/admin/calendar-view';
import { Ic, ICON } from './parts';

/** How many lines a cell lists before "+N more". */
const SHOWN = 3;

/** "08:30 · Private South Tour · 4 guests" — a pill's full reading, for its tooltip. */
export function lineTitle(l: CalLine): string {
  return [
    l.time,
    l.title,
    PEOPLE_TYPES.has(l.type) && l.guests ? `${l.guests} guest${l.guests === 1 ? '' : 's'}` : null,
    l.cancelled ? 'called off' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A line as a small tinted pill: its time in the type's ink, then its name. */
export function LinePill({
  line,
  onOpen,
  height = 22,
}: {
  line: CalLine;
  onOpen: () => void;
  height?: number;
}) {
  const T = LINE_TYPES[line.type];
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={lineTitle(line)}
      className="pointer-events-auto relative z-10 flex min-w-0 items-center gap-1.5 rounded-md px-[7px] text-left text-[12px] leading-none transition-shadow hover:shadow-[inset_0_0_0_1px_var(--dot)]"
      style={
        {
          height,
          background: T.tint,
          opacity: line.cancelled ? 0.55 : 1,
          '--dot': T.dot,
        } as React.CSSProperties
      }
    >
      {line.time && (
        <span className="shrink-0 font-bold tabular-nums" style={{ color: T.ink }}>
          {line.time}
        </span>
      )}
      <span
        className={`min-w-0 truncate font-medium text-[#1b3336] ${line.cancelled ? 'line-through' : ''}`}
      >
        {line.title}
      </span>
    </button>
  );
}

export function MonthGrid({
  cells,
  selected,
  onOpenDay,
  onOpenLine,
}: {
  cells: MonthCell[];
  /** The day open in the panel, or null when the panel is closed. */
  selected: string | null;
  onOpenDay: (day: string) => void;
  onOpenLine: (day: string, key: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e3e9e8] bg-white shadow-[0_1px_2px_rgba(15,42,45,0.04)]">
      <div className="grid grid-cols-7 border-b border-[#e3e9e8] bg-[#fafcfb]">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-2.5 text-[12px] font-semibold tracking-[0.04em] text-ink-muted md:px-3"
          >
            <span className="md:hidden">{w.slice(0, 1)}</span>
            <span className="hidden md:inline">{w.slice(0, 3)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-[#e8eeed]">
        {cells.map((c) => (
          <DayCell
            key={c.day}
            cell={c}
            selected={c.day === selected}
            onOpenDay={onOpenDay}
            onOpenLine={onOpenLine}
          />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  cell: c,
  selected,
  onOpenDay,
  onOpenLine,
}: {
  cell: MonthCell;
  selected: boolean;
  onOpenDay: (day: string) => void;
  onOpenLine: (day: string, key: string) => void;
}) {
  const n = dayNumber(c.day);
  const label = n === 1 && !c.inMonth ? `1 ${MONTHS[yearMonth(c.day)[1]]!.slice(0, 3)}` : String(n);
  const shown = c.items.slice(0, SHOWN);
  const rest = c.items.length - shown.length;
  const bg = selected
    ? 'bg-[#f1f8f7] hover:bg-[#ebf5f4]'
    : !c.inMonth
      ? 'bg-[#f7f9f9] hover:bg-[#f5faf9]'
      : c.weekend
        ? 'bg-[#fbfcfc] hover:bg-[#f5faf9]'
        : 'bg-white hover:bg-[#f5faf9]';
  const numInk = c.isToday
    ? 'bg-teal text-white'
    : !c.inMonth
      ? 'text-[#8d9b9d]'
      : c.isPast
        ? 'text-ink-muted'
        : 'text-ink';
  const fade = !c.inMonth ? 0.5 : c.isPast ? 0.72 : 1;
  const types = [...new Set(c.items.filter((l) => !l.cancelled).map((l) => l.type))];
  const summary = [
    shortDay(c.day),
    c.items.length
      ? `${c.items.length} item${c.items.length === 1 ? '' : 's'}`
      : 'nothing scheduled',
    c.guests ? `${c.guests} guest${c.guests === 1 ? '' : 's'}` : null,
    c.hasAttention ? 'needs attention' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className={`relative flex min-h-[64px] min-w-0 flex-col gap-[5px] p-1.5 pb-3.5 transition-colors md:min-h-[132px] md:p-2 md:pb-3.5 ${bg} ${
        selected ? 'shadow-[inset_0_0_0_2px_rgb(var(--color-teal))]' : ''
      }`}
    >
      {/* The whole cell opens the day; the pills above it open their own line. */}
      <button
        type="button"
        onClick={() => onOpenDay(c.day)}
        aria-label={summary}
        aria-pressed={selected}
        className="absolute inset-0 z-0 cursor-pointer"
      />
      <div className="pointer-events-none relative flex h-6 items-center justify-between gap-1.5">
        <span
          className={`inline-flex h-6 min-w-6 items-center justify-center whitespace-nowrap rounded-full px-1.5 text-[13px] font-semibold tabular-nums ${numInk}`}
        >
          {label}
        </span>
        <span className="flex min-w-0 items-center gap-[7px]">
          {c.hasAttention && (
            <span
              title="Needs attention"
              className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#e08a12] shadow-[0_0_0_3px_rgba(224,138,18,0.18)]"
            />
          )}
          {c.guests > 0 && (
            <span
              className={`hidden items-center gap-[3px] text-[12px] font-semibold tabular-nums md:inline-flex ${
                c.isPast ? 'text-ink-muted' : 'text-[#3c5255]'
              }`}
            >
              <Ic d={ICON.users} size={12} stroke={2.2} />
              {c.guests}
            </span>
          )}
        </span>
      </div>

      {/* Phone: the day's types as dots and its headcount — no room for names. */}
      <div
        className="pointer-events-none relative flex flex-wrap items-center gap-[3px] md:hidden"
        style={{ opacity: fade }}
      >
        {types.map((t) => (
          <span
            key={t}
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: LINE_TYPES[t].dot }}
          />
        ))}
        {c.guests > 0 && (
          <span className="text-[11px] font-semibold tabular-nums text-[#3c5255]">{c.guests}</span>
        )}
      </div>

      <div
        className="pointer-events-none relative hidden min-w-0 flex-col gap-[3px] md:flex"
        style={{ opacity: fade }}
      >
        {shown.map((l) => (
          <LinePill key={l.key} line={l} onOpen={() => onOpenLine(c.day, l.key)} />
        ))}
        {rest > 0 && (
          <span className="pointer-events-none px-[7px] pt-0.5 text-[12px] font-semibold text-teal-dark">
            +{rest} more
          </span>
        )}
      </div>

      {c.inMonth && c.guests > 0 && (
        <span
          title="Guest load compared with the busiest day"
          className="pointer-events-none absolute inset-x-2 bottom-1.5 h-[3px] overflow-hidden rounded-sm bg-[#edf2f1]"
        >
          <span
            className="block h-full rounded-sm bg-teal"
            style={{ width: `${Math.max(8, Math.round(c.load * 100))}%` }}
          />
        </span>
      )}
    </div>
  );
}
