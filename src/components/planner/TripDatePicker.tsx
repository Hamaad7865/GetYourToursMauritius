'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { monthCells } from '@/lib/calendar/month';
import { nominalDayKey } from '@/lib/services/day-key';
import { addDays, daySpan, MAX_TRIP_DAYS } from '@/lib/planner/trip';
import { formatLocaleDate } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '@/components/ui/icons';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Inclusive day count between two day keys. */
function nights(from: string, to: string): number {
  return daySpan(from, to) + 1;
}

/**
 * One month of the range grid. Selected days carry a small D1…D7 marker — the calendar previews the
 * planner's own Day tabs — and, once a start is picked, days beyond the {@link MAX_TRIP_DAYS} cap fade
 * out so the limit teaches itself instead of erroring after the fact.
 */
function RangeMonth({
  month,
  from,
  to,
  minDate,
  maxDate,
  locale,
  committed,
  onPick,
  onHover,
}: {
  month: Date;
  /** Range start, or the pending start while the visitor is choosing their last day. */
  from: string;
  /** Range end — the hovered day during selection, so the band previews live. */
  to: string;
  minDate: string;
  /** Latest selectable day (the 7-day cap from `from`), or '' when no start is chosen yet. */
  maxDate: string;
  locale: Locale;
  /** True once both ends are chosen — the D1…D7 markers only appear on a settled range. */
  committed: boolean;
  onPick: (key: string) => void;
  onHover: (key: string) => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-7 gap-y-0.5 text-center">
      {WEEKDAYS.map((w) => (
        <span
          key={w}
          className="pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.04em] text-ink-muted"
        >
          {t(w)}
        </span>
      ))}
      {monthCells(month.getFullYear(), month.getMonth()).map((cell, i) => {
        if (!cell) return <span key={`e${i}`} />;
        const key = nominalDayKey(cell);
        const beforeMin = key < minDate;
        const overCap = Boolean(maxDate) && key > maxDate;
        const disabled = beforeMin || overCap;
        const isStart = Boolean(from) && key === from;
        const isEnd = Boolean(to) && key === to;
        const inBand = Boolean(from) && Boolean(to) && key > from && key < to;
        const isEdge = isStart || isEnd;
        const dayNumber =
          committed && from && key >= from && key <= to ? daySpan(from, key) + 1 : null;

        const fullDate = formatLocaleDate(cell, locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            aria-label={
              dayNumber != null ? t('{date}, day {n}', { date: fullDate, n: dayNumber }) : fullDate
            }
            aria-pressed={isEdge}
            onClick={() => onPick(key)}
            onMouseEnter={() => onHover(key)}
            onFocus={() => onHover(key)}
            // The band is painted on the cell (square, edge-to-edge) while the glyph inside stays a
            // circle — so a continuous ribbon runs under the week with rounded ends.
            className={`flex flex-col items-center justify-center gap-[3px] py-1 ${
              inBand ? 'bg-teal-tint' : ''
            } ${isStart && to && !isEnd ? 'rounded-l-full bg-gradient-to-r from-transparent to-teal-tint' : ''} ${
              isEnd && from && !isStart
                ? 'rounded-r-full bg-gradient-to-l from-transparent to-teal-tint'
                : ''
            } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
          >
            <span
              className={`grid h-[32px] w-[32px] place-items-center rounded-full text-[13px] tabular-nums transition ${
                isEdge
                  ? 'bg-teal font-extrabold text-white shadow-[0_4px_12px_rgba(14,140,146,.34)]'
                  : disabled
                    ? 'font-medium text-ink/25'
                    : inBand
                      ? 'font-bold text-teal-dark'
                      : 'font-medium text-ink hover:bg-teal/10'
              }`}
            >
              {cell.getDate()}
            </span>
            {/* The signature: a settled range labels each day the way the planner will — D1, D2, D3…
                The row is always reserved (even when empty) so committing a range can't jolt the grid. */}
            <span
              aria-hidden
              className={`h-[9px] text-[8.5px] font-extrabold leading-none ${
                isEdge ? 'text-teal' : 'text-teal-dark/55'
              }`}
            >
              {dayNumber != null ? `D${dayNumber}` : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The trip-dates control for the planner hero: one pill that opens a branded two-month range calendar
 * (one month on mobile). Replaces a pair of native `<input type="date">`, whose browser-chrome popup
 * couldn't show a range at all. Picking a start then an end commits the trip; the parent clamps and
 * enumerates the dates ({@link MAX_TRIP_DAYS}).
 */
export function TripDatePicker({
  from,
  to,
  onChange,
  minDate,
}: {
  from: string;
  to: string;
  /** Commits a range, or ('', '') when cleared. A same-day pick returns that day twice. */
  onChange: (from: string, to: string) => void;
  /** Earliest plannable day (tomorrow — we don't fulfil same-day). */
  minDate: string;
}) {
  const t = useT();
  const { language } = usePreferences();
  const [open, setOpen] = useState(false);
  // The start of a range being chosen ('' = not mid-selection, so `from`/`to` are what's shown).
  const [pendingFrom, setPendingFrom] = useState('');
  const [hovered, setHovered] = useState('');
  const [view, setView] = useState(() => new Date());
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Open on the month the trip starts in (or this month), and always start a fresh selection.
  useEffect(() => {
    if (!open) return;
    setPendingFrom('');
    setHovered('');
    const anchor = from || minDate;
    if (anchor) {
      const d = new Date(`${anchor}T00:00:00`);
      if (!Number.isNaN(d.getTime())) setView(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }, [open, from, minDate]);

  // Close on Escape (restoring focus to the trigger) or a click outside — the popover is anchored,
  // not modal, so it must not trap the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // What the grid paints: the pending selection (with the hovered day as a live end) or the committed
  // range. `maxDate` is the 7-day cap, which only exists while a start is pending.
  const selecting = Boolean(pendingFrom);
  const gridFrom = selecting ? pendingFrom : from;
  const gridTo = selecting ? (hovered > pendingFrom ? hovered : '') : to;
  const maxDate = selecting ? addDays(pendingFrom, MAX_TRIP_DAYS - 1) : '';
  const nextMonth = useMemo(() => new Date(view.getFullYear(), view.getMonth() + 1, 1), [view]);
  const canBack = useMemo(() => {
    const min = new Date(`${minDate || nominalDayKey(new Date())}T00:00:00`);
    return view > new Date(min.getFullYear(), min.getMonth(), 1);
  }, [view, minDate]);

  function pick(key: string) {
    if (!pendingFrom || key < pendingFrom) {
      // First click, or a click before the pending start — (re)start the range here.
      setPendingFrom(key);
      setHovered('');
      return;
    }
    onChange(pendingFrom, key);
    setPendingFrom('');
    setHovered('');
    setOpen(false);
    triggerRef.current?.focus();
  }

  const dayCount = from && to ? nights(from, to) : 0;
  const label =
    from && to
      ? `${formatLocaleDate(new Date(`${from}T00:00:00`), language, { day: 'numeric', month: 'short' })} – ${formatLocaleDate(
          new Date(`${to}T00:00:00`),
          language,
          { day: 'numeric', month: 'short', year: 'numeric' },
        )}`
      : t('Add your trip dates');

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 rounded-[14px] border bg-white px-3.5 py-2.5 text-left transition hover:border-teal ${
          open ? 'border-teal shadow-[0_0_0_3px_rgba(14,140,146,.12)]' : 'border-[#E3EEEC]'
        }`}
      >
        <IconCalendar width={17} height={17} className="shrink-0 text-teal" />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[13.5px] font-bold ${from && to ? 'text-ink' : 'text-ink-muted'}`}
          >
            {label}
          </span>
          <span className="block text-[11px] font-semibold text-ink-muted">
            {dayCount > 0
              ? t('{n} days · ZilAi plans each one', { n: dayCount })
              : t('Optional · plan up to {max} days', { max: MAX_TRIP_DAYS })}
          </span>
        </span>
        {dayCount > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t('Clear trip dates')}
            onClick={(e) => {
              e.stopPropagation();
              onChange('', '');
              setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onChange('', '');
              }
            }}
            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted transition hover:bg-[#FDECEA] hover:text-coral"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth={2.4}
                strokeLinecap="round"
              />
            </svg>
          </span>
        )}
      </button>

      {open && (
        // Two elements on purpose: the outer one owns the centering transform, the inner one owns the
        // pop animation. Sharing them would let the animation's `transform: scale()` overwrite
        // `-translate-x-1/2` mid-flight and shove the panel off the right edge of the viewport.
        <div className="absolute left-1/2 top-[calc(100%+8px)] z-40 w-[min(94vw,20rem)] -translate-x-1/2 sm:w-[36rem]">
          <div
            role="dialog"
            aria-label={t('Choose your trip dates')}
            className="w-full rounded-[20px] border border-[#E3EEEC] bg-white p-4 text-left shadow-[0_28px_60px_-24px_rgba(10,46,54,.45)] motion-safe:animate-pop"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label={t('Previous month')}
                disabled={!canBack}
                onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition hover:bg-teal-tint disabled:cursor-default disabled:opacity-25"
              >
                <IconChevronLeft width={15} height={15} />
              </button>
              <div className="flex flex-1 justify-around font-display text-[15px] font-semibold text-ink">
                <span>{formatLocaleDate(view, language, { month: 'long', year: 'numeric' })}</span>
                <span className="hidden sm:inline">
                  {formatLocaleDate(nextMonth, language, { month: 'long', year: 'numeric' })}
                </span>
              </div>
              <button
                type="button"
                aria-label={t('Next month')}
                onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition hover:bg-teal-tint"
              >
                <IconChevronRight width={15} height={15} />
              </button>
            </div>

            <div className="flex gap-6" onMouseLeave={() => setHovered('')}>
              <div className="flex-1">
                <RangeMonth
                  month={view}
                  from={gridFrom}
                  to={gridTo}
                  minDate={minDate}
                  maxDate={maxDate}
                  locale={language}
                  committed={!selecting && Boolean(from && to)}
                  onPick={pick}
                  onHover={setHovered}
                />
              </div>
              <div className="hidden flex-1 sm:block">
                <RangeMonth
                  month={nextMonth}
                  from={gridFrom}
                  to={gridTo}
                  minDate={minDate}
                  maxDate={maxDate}
                  locale={language}
                  committed={!selecting && Boolean(from && to)}
                  onPick={pick}
                  onHover={setHovered}
                />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#EEF4F3] pt-3">
              <p className="m-0 text-[12.5px] font-semibold text-ink-muted" aria-live="polite">
                {selecting
                  ? t('Now pick your last day — up to {max}', { max: MAX_TRIP_DAYS })
                  : from && to
                    ? t('{n} days planned', { n: dayCount })
                    : t('Pick your first day')}
              </p>
              {(from || selecting) && (
                <button
                  type="button"
                  onClick={() => {
                    setPendingFrom('');
                    setHovered('');
                    onChange('', '');
                  }}
                  className="shrink-0 cursor-pointer rounded-[9px] px-2.5 py-1.5 text-[12.5px] font-bold text-coral transition hover:bg-[#FDECEA]"
                >
                  {t('Clear')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
