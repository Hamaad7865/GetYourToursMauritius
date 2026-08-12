'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { monthCells } from '@/lib/calendar/month';
import { nominalDayKey } from '@/lib/services/day-key';
import { formatLocaleDate } from '@/lib/i18n/format';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '@/components/ui/icons';

/*
 * ONE branded single-date picker for the whole app, replacing native <input type="date"> — whose
 * popup is the unstyleable OS calendar (grey chrome, no brand, inconsistent across browsers and
 * locales). Same visual language as the planner's range calendar (TripDatePicker).
 *
 * Drop-in: the value is the same 'YYYY-MM-DD' string a native date input uses, and `min`/`max` are the
 * same bounds — so swapping a native input for this needs only value / onChange / min / max.
 *
 * Drills day → month → year (click the header title) so a far-back date like a birthday is a couple of
 * clicks, not hundreds. Keyboard: arrows move the day, Enter picks, Esc closes, PageUp/Dn change month.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Parts = { y: number; m: number; d: number };

/** Parse a 'YYYY-MM-DD' key, or null for empty / malformed (so a bad stored value never throws). */
function parseKey(key: string | null | undefined): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((key ?? '').trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}

function keyOf(y: number, m: number, d: number): string {
  return nominalDayKey(new Date(y, m, d));
}

type Mode = 'day' | 'month' | 'year';

export function DatePicker({
  value,
  onChange,
  min,
  max,
  id,
  placeholder,
  ariaLabel,
  ariaDescribedby,
  ariaInvalid,
  className,
  allowClear = true,
  children,
}: {
  /** 'YYYY-MM-DD' or '' — identical to a native date input's value. */
  value: string;
  onChange: (key: string) => void;
  min?: string;
  max?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  ariaDescribedby?: string;
  ariaInvalid?: boolean;
  /** Extra trigger classes. With no `children` these ADD to the default field layout (so a pill or a
   *  wider box just passes its border/padding/shape); with `children` they are the WHOLE trigger class. */
  className?: string;
  allowClear?: boolean;
  /** Custom trigger content (e.g. an icon + the site's own date text + a chevron). When given, the
   *  button renders this instead of the default "date · calendar icon", so a field that already had a
   *  bespoke look keeps it and only its POPUP changes from the native calendar to this one. */
  children?: ReactNode;
}) {
  const t = useT();
  const { language } = usePreferences();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('day');
  const selected = useMemo(() => parseKey(value), [value]);
  // The month on view (1st of month). Opens on the selected date's month, else the clamped today.
  const [view, setView] = useState(() => new Date());
  // The keyboard-focused day within the grid; follows the selection/today when the panel opens.
  const [activeKey, setActiveKey] = useState('');

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const minKey = (min ?? '').trim();
  const maxKey = (max ?? '').trim();
  const minY = parseKey(minKey)?.y ?? 1900;
  const maxY = parseKey(maxKey)?.y ?? 2100;

  const dayDisabled = useCallback(
    (key: string) => (minKey && key < minKey) || (maxKey && key > maxKey),
    [minKey, maxKey],
  );

  const clampView = useCallback(
    (d: Date) => {
      const y = Math.min(Math.max(d.getFullYear(), minY), maxY);
      return new Date(y, d.getMonth(), 1);
    },
    [minY, maxY],
  );

  // On open: land on the selected month (or today, clamped), reset to the day grid, and aim the
  // keyboard cursor at the selection / today so the first arrow key has somewhere sensible to move.
  useEffect(() => {
    if (!open) return;
    setMode('day');
    const base = selected ? new Date(selected.y, selected.m, 1) : clampView(new Date());
    setView(base);
    const todayKey = nominalDayKey(new Date());
    const aim = value || (!dayDisabled(todayKey) ? todayKey : minKey || maxKey || todayKey);
    setActiveKey(aim);
  }, [open, value, selected, clampView, dayDisabled, minKey, maxKey]);

  // Close on outside pointer / Escape (Escape returns focus to the trigger; the panel is anchored,
  // not modal, so it must never trap the page).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Keep the keyboard-focused day actually focused as it moves.
  useEffect(() => {
    if (open && mode === 'day' && activeKey) {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-daykey="${activeKey}"]`)?.focus();
    }
  }, [activeKey, open, mode]);

  const commit = useCallback(
    (key: string) => {
      onChange(key);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

  function moveActive(deltaDays: number) {
    const base = parseKey(activeKey) ?? selected ?? { ...splitDate(view), d: 1 };
    const d = new Date(base.y, base.m, base.d + deltaDays);
    const key = nominalDayKey(d);
    if (dayDisabled(key)) return;
    setView(new Date(d.getFullYear(), d.getMonth(), 1));
    setActiveKey(key);
  }

  function onGridKeyDown(e: ReactKeyboardEvent) {
    const map: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (e.key in map) {
      e.preventDefault();
      moveActive(map[e.key]!);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      setView((v) => clampView(new Date(v.getFullYear(), v.getMonth() - 1, 1)));
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      setView((v) => clampView(new Date(v.getFullYear(), v.getMonth() + 1, 1)));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (activeKey && !dayDisabled(activeKey)) commit(activeKey);
    }
  }

  const viewY = view.getFullYear();
  const viewM = view.getMonth();
  const canPrevMonth = !minKey || keyOf(viewY, viewM, 1) > minKey;
  const canNextMonth = !maxKey || keyOf(viewY, viewM + 1, 0) < maxKey;
  const todayKey = nominalDayKey(new Date());

  const label = selected
    ? formatLocaleDate(new Date(selected.y, selected.m, selected.d), language, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : (placeholder ?? t('Select a date'));

  // Decade page for the year grid (12 years, aligned).
  const yearPageStart = viewY - ((viewY - minY) % 12 || 0);

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedby}
        className={
          children
            ? className
            : `flex w-full items-center gap-2 text-left outline-none transition-colors ${
                className ??
                `rounded-xl border bg-white px-3.5 py-2.5 text-sm hover:border-ink/30 focus:border-teal focus-visible:ring-2 focus-visible:ring-teal/25 ${
                  ariaInvalid ? 'border-coral-dark' : 'border-ink/15'
                }`
              }`
        }
      >
        {children ?? (
          <>
            <span className={`min-w-0 flex-1 truncate ${selected ? 'text-ink' : 'text-ink-muted'}`}>
              {label}
            </span>
            <IconCalendar width={16} height={16} className="shrink-0 text-teal" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-[min(20rem,calc(100vw-2rem))]">
          <div
            role="dialog"
            aria-label={ariaLabel ?? t('Choose a date')}
            className="rounded-2xl border border-ink/10 bg-white p-3 shadow-[0_20px_56px_-16px_rgba(10,46,54,0.35)] motion-safe:animate-pop"
          >
            {/* Header: ‹ [title] › — the chevrons page, the title drills day → month → year. */}
            <div className="mb-2 flex items-center gap-1">
              <button
                type="button"
                aria-label={mode === 'year' ? t('Previous years') : t('Previous month')}
                disabled={
                  mode === 'day' ? !canPrevMonth : mode === 'year' ? yearPageStart <= minY : false
                }
                onClick={() => {
                  if (mode === 'day') setView(clampView(new Date(viewY, viewM - 1, 1)));
                  else if (mode === 'year')
                    setView(clampView(new Date(yearPageStart - 12, viewM, 1)));
                  else setView(clampView(new Date(viewY - 1, viewM, 1)));
                }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink transition hover:bg-teal-tint disabled:opacity-25"
              >
                <IconChevronLeft width={15} height={15} />
              </button>
              <button
                type="button"
                onClick={() =>
                  setMode((m) => (m === 'day' ? 'month' : m === 'month' ? 'year' : 'day'))
                }
                className="flex-1 rounded-lg px-2 py-1.5 text-center text-[15px] font-bold text-ink transition hover:bg-teal-tint"
              >
                {mode === 'day'
                  ? formatLocaleDate(view, language, { month: 'long', year: 'numeric' })
                  : mode === 'month'
                    ? String(viewY)
                    : `${yearPageStart} – ${yearPageStart + 11}`}
              </button>
              <button
                type="button"
                aria-label={mode === 'year' ? t('Next years') : t('Next month')}
                disabled={
                  mode === 'day'
                    ? !canNextMonth
                    : mode === 'year'
                      ? yearPageStart + 12 > maxY
                      : false
                }
                onClick={() => {
                  if (mode === 'day') setView(clampView(new Date(viewY, viewM + 1, 1)));
                  else if (mode === 'year')
                    setView(clampView(new Date(yearPageStart + 12, viewM, 1)));
                  else setView(clampView(new Date(viewY + 1, viewM, 1)));
                }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink transition hover:bg-teal-tint disabled:opacity-25"
              >
                <IconChevronRight width={15} height={15} />
              </button>
            </div>

            {mode === 'day' && (
              <div ref={gridRef} onKeyDown={onGridKeyDown}>
                <div className="grid grid-cols-7 text-center">
                  {WEEKDAYS.map((w) => (
                    <span
                      key={w}
                      className="pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.04em] text-ink-muted"
                    >
                      {t(w)}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-y-0.5 text-center">
                  {monthCells(viewY, viewM).map((cell, i) => {
                    if (!cell) return <span key={`e${i}`} />;
                    const key = nominalDayKey(cell);
                    const isSelected = value === key;
                    const isToday = key === todayKey;
                    const isActive = key === activeKey;
                    const disabled = Boolean(dayDisabled(key));
                    const fullDate = formatLocaleDate(cell, language, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    });
                    return (
                      <button
                        key={key}
                        type="button"
                        data-daykey={key}
                        disabled={disabled}
                        tabIndex={isActive ? 0 : -1}
                        aria-label={fullDate}
                        aria-pressed={isSelected}
                        onClick={() => commit(key)}
                        className="flex items-center justify-center py-0.5"
                      >
                        <span
                          className={`grid h-9 w-9 place-items-center rounded-full text-[13px] tabular-nums transition ${
                            isSelected
                              ? 'bg-teal font-extrabold text-white shadow-[0_4px_12px_rgba(14,140,146,.34)]'
                              : disabled
                                ? 'font-medium text-ink/25'
                                : isActive
                                  ? 'bg-teal/10 font-bold text-teal-dark ring-1 ring-inset ring-teal/40'
                                  : isToday
                                    ? 'font-bold text-teal-dark ring-1 ring-inset ring-teal/30'
                                    : 'font-medium text-ink hover:bg-teal/10'
                          }`}
                        >
                          {cell.getDate()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {mode === 'month' && (
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 12 }, (_, m) => {
                  const disabled =
                    (minKey && keyOf(viewY, m + 1, 0) < minKey) ||
                    (maxKey && keyOf(viewY, m, 1) > maxKey);
                  const isSel = selected?.y === viewY && selected?.m === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={Boolean(disabled)}
                      onClick={() => {
                        setView(new Date(viewY, m, 1));
                        setMode('day');
                      }}
                      className={`rounded-xl px-2 py-2.5 text-sm font-semibold capitalize transition ${
                        isSel
                          ? 'bg-teal text-white'
                          : disabled
                            ? 'text-ink/25'
                            : 'text-ink hover:bg-teal-tint'
                      }`}
                    >
                      {formatLocaleDate(new Date(viewY, m, 1), language, { month: 'short' })}
                    </button>
                  );
                })}
              </div>
            )}

            {mode === 'year' && (
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 12 }, (_, i) => yearPageStart + i).map((y) => {
                  const disabled = y < minY || y > maxY;
                  const isSel = selected?.y === y;
                  return (
                    <button
                      key={y}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setView(new Date(y, viewM, 1));
                        setMode('month');
                      }}
                      className={`rounded-xl px-2 py-2.5 text-sm font-semibold tabular-nums transition ${
                        isSel
                          ? 'bg-teal text-white'
                          : disabled
                            ? 'text-ink/25'
                            : 'text-ink hover:bg-teal-tint'
                      }`}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-ink/10 pt-2">
              {allowClear && value ? (
                <button
                  type="button"
                  onClick={() => commit('')}
                  className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-bold text-coral-dark transition hover:bg-[#FDECEA]"
                >
                  {t('Clear')}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                disabled={Boolean(dayDisabled(todayKey))}
                onClick={() => commit(todayKey)}
                className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-bold text-teal-dark transition hover:bg-teal-tint disabled:opacity-30"
              >
                {t('Today')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** view (a 1st-of-month Date) → its parts, for seeding a keyboard move when nothing is active yet. */
function splitDate(view: Date): { y: number; m: number } {
  return { y: view.getFullYear(), m: view.getMonth() };
}
