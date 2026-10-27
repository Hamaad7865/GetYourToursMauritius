'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can } from '@/lib/admin/permissions';
import { mauDay } from '@/lib/admin/format';
import { useDialog } from '@/lib/a11y/useDialog';
import { loadCalendarRange, loadDaySchedule, type DayEntry } from '@/lib/admin/calendar';
import {
  ALL_TYPES_ON,
  LINE_TYPES,
  MONTHS,
  TYPE_ORDER,
  addDays,
  dayNumber,
  dayOf,
  deltaPct,
  guestsOn,
  linesByDay,
  mauritiusMinutes,
  mondayOf,
  monthCells,
  monthGridRange,
  passes,
  shortDay,
  summarize,
  toCalLines,
  weekdayIndex,
  yearMonth,
  type CalFilters,
  type CalLine,
  type LineType,
} from '@/lib/admin/calendar-view';
import { AdminError } from './ui';
import { DayPanel, type PanelActions } from './calendar/DayPanel';
import { MonthGrid } from './calendar/MonthGrid';
import { WeekGrid, type WeekDay } from './calendar/WeekGrid';
import { euros, Ic, ICON, Toast, type ToastState } from './calendar/parts';

/* The operations calendar: every departure, day by day. A month or week of what is booked, the
 * period's figures, and a day panel with each guest's run sheet — from which staff change a
 * departure's time, move it to another day, or call it off. Everything is in Mauritius time. */

type View = 'month' | 'week';
/** When the calendar itself is this wide (a 1360px screen beside the sidebar) the day panel docks
 *  beside it; narrower — a small screen, or the assistant column open — it slides over with a scrim. */
const DOCK_AT = 1110;

/** The calendar's own width — not the window's: the assistant column narrows it without a resize. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** The admin top bar's real height, so the docked panel sits flush under it. */
function useTopbarHeight(): number {
  const [height, setHeight] = useState(65);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-admin-topbar]');
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return height;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  const tag = t?.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    !!t?.isContentEditable ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey
  );
}

export function AdminCalendar() {
  const access = useAdminAccess();
  const showMoney = can(access, 'money.revenue');

  // Mauritius "today" and clock, refreshed each minute (the timeline's now-line moves with it).
  const [today, setToday] = useState(() => mauDay(new Date()));
  const [nowMinutes, setNowMinutes] = useState(() => mauritiusMinutes(new Date()));
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      setToday(mauDay(now));
      setNowMinutes(mauritiusMinutes(now));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const width = useWidth(rootRef);
  const docked = width >= DOCK_AT;
  const topbar = useTopbarHeight();

  const [view, setView] = useState<View>('month');
  const [ym, setYm] = useState<[number, number]>(() => yearMonth(today));
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [selected, setSelected] = useState(today);
  const [panelOpen, setPanelOpen] = useState(false);
  const [filters, setFilters] = useState<CalFilters>({
    types: ALL_TYPES_ON,
    attentionOnly: false,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On a wide screen the day panel opens on today, docked; on a narrow one it waits to be asked.
  const openedOnce = useRef(false);
  useEffect(() => {
    if (openedOnce.current || width === 0) return;
    openedOnce.current = true;
    if (width >= DOCK_AT) setPanelOpen(true);
  }, [width]);
  // When the calendar narrows out of docking (the assistant column opening, a window shrinking), the
  // docked panel closes rather than turning into an overlay over whatever made room.
  const wasDocked = useRef(false);
  useEffect(() => {
    if (width === 0) return;
    if (wasDocked.current && !docked) setPanelOpen(false);
    wasDocked.current = docked;
  }, [docked, width]);

  // ── The period on screen, and the one before it (for the "vs last month" figure) ──
  const month = monthGridRange(ym[0], ym[1]);
  const range =
    view === 'month'
      ? { from: month.from, to: month.to }
      : { from: weekStart, to: addDays(weekStart, 6) };
  const period = view === 'month' ? { from: month.first, to: month.last } : range;
  const previous = useMemo(() => {
    if (view === 'week') return { from: addDays(weekStart, -7), to: addDays(weekStart, -1) };
    const p = monthGridRange(ym[0], ym[1] - 1);
    return { from: p.first, to: p.last };
  }, [view, weekStart, ym]);

  const [entries, setEntries] = useState<DayEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prevLines, setPrevLines] = useState<CalLine[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    loadCalendarRange(range.from, range.to)
      .then((rows) => {
        if (live) setEntries(rows);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : 'Could not load the calendar.');
        setEntries((prev) => prev ?? []);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [range.from, range.to, reloadKey]);

  useEffect(() => {
    if (!showMoney) return;
    let live = true;
    setPrevLines(null);
    loadCalendarRange(previous.from, previous.to)
      .then((rows) => live && setPrevLines(toCalLines(rows, today)))
      .catch(() => live && setPrevLines([]));
    return () => {
      live = false;
    };
  }, [previous.from, previous.to, showMoney, today]);

  const lines = useMemo(() => (entries ? toCalLines(entries, today) : []), [entries, today]);
  const byDay = useMemo(() => linesByDay(lines), [lines]);

  // The panel's day may sit outside the period on screen (after paging months with it open): read it
  // on its own then.
  const selectedInRange = selected >= range.from && selected <= range.to;
  const [dayLines, setDayLines] = useState<CalLine[] | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  useEffect(() => {
    if (!panelOpen || selectedInRange) return;
    let live = true;
    setDayLines(null);
    setDayError(null);
    loadDaySchedule(selected)
      .then((rows) => live && setDayLines(toCalLines(rows, today)))
      .catch((e: unknown) => {
        if (!live) return;
        setDayError(e instanceof Error ? e.message : 'Could not load this day.');
        setDayLines([]);
      });
    return () => {
      live = false;
    };
  }, [panelOpen, selected, selectedInRange, today, reloadKey]);
  const panelLines = selectedInRange ? (byDay.get(selected) ?? []) : (dayLines ?? []);
  // While a period loads, the old period's lines are still on screen — so "loading", not "empty".
  const panelLoading = selectedInRange ? loading : dayLines === null;

  // ── Navigation ──
  const shiftPeriod = useCallback(
    (dir: number) => {
      if (view === 'month') setYm(([y, m]) => yearMonth(dayOf(y, m + dir, 1)));
      else setWeekStart((w) => addDays(w, 7 * dir));
    },
    [view],
  );

  const follow = useCallback(
    (day: string) => {
      if (view === 'month') {
        const [y, m] = yearMonth(day);
        if (y !== ym[0] || m !== ym[1]) setYm([y, m]);
      } else if (mondayOf(day) !== weekStart) setWeekStart(mondayOf(day));
    },
    [view, ym, weekStart],
  );

  const openDay = useCallback(
    (day: string, lineKey?: string, followIt = false) => {
      setSelected(day);
      setPanelOpen(true);
      setFocusKey(lineKey ?? null);
      if (lineKey) setExpanded((s) => new Set(s).add(lineKey));
      if (followIt) follow(day);
    },
    [follow],
  );

  const shiftDay = useCallback(
    (dir: number) => {
      const d = addDays(selected, dir);
      setSelected(d);
      setFocusKey(null);
      follow(d);
    },
    [selected, follow],
  );

  const goToday = useCallback(() => {
    setYm(yearMonth(today));
    setWeekStart(mondayOf(today));
    setSelected(today);
    setPanelOpen(true);
  }, [today]);

  const changeView = useCallback(
    (v: View) => {
      if (v === view) return;
      if (v === 'week') {
        const inMonth = (d: string) => {
          const [y, m] = yearMonth(d);
          return y === ym[0] && m === ym[1];
        };
        const anchor = inMonth(selected) ? selected : inMonth(today) ? today : month.first;
        setWeekStart(mondayOf(anchor));
      } else setYm(yearMonth(addDays(weekStart, 3)));
      setView(v);
    },
    [view, ym, selected, today, month.first, weekStart],
  );

  const closePanel = useCallback(() => setPanelOpen(false), []);

  // ← → move the day (panel open) or the period; Esc closes the docked panel. (The overlay's own
  // dialog hook handles Esc there.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === 'Escape') {
        if (panelOpen && docked) setPanelOpen(false);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (panelOpen) shiftDay(dir);
        else shiftPeriod(dir);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, docked, shiftDay, shiftPeriod]);

  // ── Toasts ──
  const showToast = useCallback((next: Omit<ToastState, 'id'>) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ ...next, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const actions: PanelActions = useMemo(
    () => ({
      onChanged: reload,
      onToast: (message, opts) => {
        reload();
        showToast({
          message,
          undo: opts?.undo
            ? () => {
                void opts.undo!()
                  .then(() => {
                    reload();
                    showToast({ message: 'Undone.' });
                  })
                  .catch(() =>
                    showToast({ message: 'Could not undo that — change it back by hand.' }),
                  );
              }
            : undefined,
          showDay: opts?.showDay ? () => openDay(opts.showDay!, undefined, true) : undefined,
        });
      },
    }),
    [reload, showToast, openDay],
  );

  // ── Figures ──
  const summary = summarize(lines, period.from, period.to, filters);
  const prevValue = prevLines
    ? summarize(prevLines, previous.from, previous.to, filters).valueEur
    : null;
  const delta = prevValue == null ? undefined : deltaPct(summary.valueEur, prevValue);
  const prevName = view === 'month' ? MONTHS[(ym[1] + 11) % 12]! : 'last week';

  const periodTitle =
    view === 'month'
      ? MONTHS[ym[1]]!
      : (() => {
          const end = addDays(weekStart, 6);
          const [, m1] = yearMonth(weekStart);
          const [, m2] = yearMonth(end);
          return m1 === m2
            ? `${dayNumber(weekStart)}–${dayNumber(end)} ${MONTHS[m2]}`
            : `${dayNumber(weekStart)} ${MONTHS[m1]!.slice(0, 3)} – ${dayNumber(end)} ${MONTHS[m2]!.slice(0, 3)}`;
        })();
  const periodYear = view === 'month' ? ym[0] : yearMonth(addDays(weekStart, 6))[0];

  const cells = useMemo(
    () => (view === 'month' ? monthCells(ym[0], ym[1], byDay, today, filters) : []),
    [view, ym, byDay, today, filters],
  );
  const weekDays: WeekDay[] = useMemo(() => {
    if (view !== 'week') return [];
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      const all = byDay.get(day) ?? [];
      const visible = all.filter((l) => passes(l, filters));
      return {
        day,
        isToday: day === today,
        isPast: day < today,
        weekend: weekdayIndex(day) >= 5,
        lines: visible,
        guests: guestsOn(all, filters),
        valueEur: visible.filter((l) => !l.cancelled).reduce((s, l) => s + l.valueEur, 0),
      };
    });
  }, [view, weekStart, byDay, today, filters]);

  const panelSelected = panelOpen ? selected : null;
  const panel = (
    <DayPanel
      day={selected}
      today={today}
      nowMinutes={nowMinutes}
      lines={panelLines}
      loading={panelLoading}
      error={selectedInRange ? null : dayError}
      showMoney={showMoney}
      expanded={expanded}
      onToggle={(key) =>
        setExpanded((s) => {
          const next = new Set(s);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        })
      }
      onPrev={() => shiftDay(-1)}
      onNext={() => shiftDay(1)}
      onClose={closePanel}
      actions={actions}
      focusKey={focusKey}
    />
  );

  return (
    <div ref={rootRef} className="flex min-w-0">
      <div className="min-w-0 flex-1 px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pt-7">
        <div className="mx-auto flex max-w-[1640px] flex-col gap-[18px]">
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-teal-dark">
                Calendar
              </p>
              <h1 className="text-[34px] font-extrabold leading-none tracking-[-0.025em] text-ink sm:text-[42px]">
                {periodTitle}
                <span className="ml-3 font-semibold text-[#7d8d8f]">{periodYear}</span>
              </h1>
              <p className="mt-0.5 max-w-[620px] text-[14.5px] leading-[1.5] text-ink-muted [text-wrap:pretty]">
                Every departure, day by day. Open a day for pickups, child seats, flights and notes,
                then move a departure or call it off.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <div
                className="flex gap-0.5 rounded-[11px] bg-[#e6eceb] p-[3px]"
                role="group"
                aria-label="View"
              >
                {(['month', 'week'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => changeView(v)}
                    aria-pressed={view === v}
                    className={`h-8 rounded-lg px-4 text-[13px] font-semibold capitalize ${
                      view === v
                        ? 'bg-white text-ink shadow-[0_1px_2px_rgba(15,42,45,0.14)]'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={goToday}
                className="h-[38px] rounded-[10px] border border-[#d6dfde] bg-white px-3.5 text-[13.5px] font-semibold text-ink hover:bg-[#f3f6f5]"
              >
                Today
              </button>
              <div className="flex gap-1.5">
                <NavButton
                  title={view === 'month' ? 'Previous month' : 'Previous week'}
                  d={ICON.chevronLeft}
                  onClick={() => shiftPeriod(-1)}
                />
                <NavButton
                  title={view === 'month' ? 'Next month' : 'Next week'}
                  d={ICON.chevronRight}
                  onClick={() => shiftPeriod(1)}
                />
              </div>
            </div>
          </header>

          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-[#e3e9e8] bg-white lg:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
            <Kpi
              label="Departures"
              dot="#0f8387"
              value={String(summary.departures)}
              sub={summary.calledOff ? `${summary.calledOff} called off` : 'None called off'}
            />
            <Kpi
              label="Guests"
              dot="#2b6fd6"
              value={summary.guests.toLocaleString('en-GB')}
              sub={
                summary.peak
                  ? `Busiest ${shortDay(summary.peak.day)} · ${summary.peak.guests} guests`
                  : 'No guests booked'
              }
            />
            {showMoney && (
              <Kpi
                label="Booked"
                dot="#8a56c8"
                value={euros(summary.valueEur)}
                sub={
                  delta === undefined
                    ? '…'
                    : delta === null
                      ? `Nothing booked ${view === 'month' ? 'in ' : ''}${prevName}`
                      : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}% vs ${prevName}`
                }
              />
            )}
            <Kpi
              label="Needs attention"
              dot="#e08a12"
              value={String(summary.attention)}
              sub={
                summary.attention
                  ? 'Missing pickups, flights or payments'
                  : 'Everything is in order'
              }
              active={filters.attentionOnly}
              action={
                summary.attention > 0 || filters.attentionOnly
                  ? filters.attentionOnly
                    ? 'Show all'
                    : 'Review'
                  : undefined
              }
              onClick={() => setFilters((f) => ({ ...f, attentionOnly: !f.attentionOnly }))}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {TYPE_ORDER.map((t) => (
                <TypeChip
                  key={t}
                  type={t}
                  on={filters.types[t]}
                  count={summary.typeCounts[t]}
                  onClick={() =>
                    setFilters((f) => ({ ...f, types: { ...f.types, [t]: !f.types[t] } }))
                  }
                />
              ))}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={filters.attentionOnly}
              onClick={() => setFilters((f) => ({ ...f, attentionOnly: !f.attentionOnly }))}
              className={`flex h-8 items-center gap-2.5 rounded-full border pl-1.5 pr-3 text-[13px] font-medium text-[#3c5255] ${
                filters.attentionOnly
                  ? 'border-[#f0cf9a] bg-[#fff7ea]'
                  : 'border-[#d6dfde] bg-white'
              }`}
            >
              <span
                className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${
                  filters.attentionOnly ? 'bg-[#e08a12]' : 'bg-[#cdd8d7]'
                }`}
              >
                <span
                  className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-[left]"
                  style={{ left: filters.attentionOnly ? 14 : 2 }}
                />
              </span>
              Only what needs attention
            </button>
          </div>

          {error && <AdminError>{error}</AdminError>}

          <div
            className={`transition-opacity ${loading && entries !== null ? 'opacity-60' : ''}`}
            aria-busy={loading}
          >
            {view === 'month' ? (
              <MonthGrid
                cells={cells}
                selected={panelSelected}
                onOpenDay={(d) => openDay(d)}
                onOpenLine={(d, key) => openDay(d, key)}
              />
            ) : (
              <WeekGrid
                days={weekDays}
                selected={panelSelected}
                showMoney={showMoney}
                onOpenDay={(d) => openDay(d)}
                onOpenLine={(d, key) => openDay(d, key)}
              />
            )}
            {loading && entries === null && (
              <p className="py-6 text-center text-sm text-ink-muted">Loading…</p>
            )}
          </div>

          <div className="hidden flex-wrap justify-end gap-3.5 text-[12px] text-[#6b7c7e] lg:flex">
            <span>← → change day or period</span>
            <span>Esc closes the panel</span>
          </div>
        </div>
      </div>

      {panelOpen && docked && (
        <aside
          aria-label="Day"
          className="sticky w-[440px] shrink-0 self-start border-l border-[#e3e9e8]"
          style={{ top: topbar, height: `calc(100dvh - ${topbar}px)` }}
        >
          {panel}
        </aside>
      )}

      {panelOpen && !docked && width > 0 && (
        <OverlayPanel onClose={closePanel}>{panel}</OverlayPanel>
      )}

      {toast && <Toast key={toast.id} toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function OverlayPanel({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useDialog(true, onClose);
  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(8,30,33,0.32)] backdrop-blur-[2px]"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Day"
        tabIndex={-1}
        className="absolute inset-y-0 right-0 w-[min(460px,100vw)] shadow-[-30px_0_60px_-24px_rgba(8,30,33,0.45)]"
      >
        {children}
      </div>
    </div>
  );
}

function NavButton({ title, d, onClick }: { title: string; d: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-[#d6dfde] bg-white text-ink hover:bg-[#f3f6f5]"
    >
      <Ic d={d} size={18} />
    </button>
  );
}

function Kpi({
  label,
  dot,
  value,
  sub,
  active = false,
  action,
  onClick,
}: {
  label: string;
  dot: string;
  value: string;
  sub: string;
  active?: boolean;
  action?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3c5255]">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: dot }} />
        <span>{label}</span>
        {action && <span className="ml-auto text-[12px] font-bold text-[#a15c07]">{action}</span>}
      </span>
      <span className="text-[30px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-ink">
        {value}
      </span>
      <span className="text-[12.5px] text-ink-muted">{sub}</span>
    </>
  );
  const cls = `-ml-px flex flex-col gap-1.5 border-l border-t border-[#e9eeed] px-5 pb-[15px] pt-4 text-left transition-colors lg:border-t-0 ${
    active ? 'bg-[#fff7ea]' : 'bg-white'
  }`;
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${cls} ${active ? 'hover:bg-[#fff2dc]' : 'hover:bg-[#fbfaf6]'}`}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function TypeChip({
  type,
  on,
  count,
  onClick,
}: {
  type: LineType;
  on: boolean;
  count: number;
  onClick: () => void;
}) {
  const T = LINE_TYPES[type];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-8 items-center gap-2 rounded-full border pl-[11px] pr-3 text-[13px] font-medium transition-colors hover:border-[#b8c8c6] ${
        on ? 'border-[#d6dfde] bg-white text-ink' : 'border-[#dfe6e5] bg-transparent text-[#6b7c7e]'
      }`}
    >
      <span
        className="h-[9px] w-[9px] shrink-0 rounded-full"
        style={{ background: on ? T.dot : 'transparent', boxShadow: `inset 0 0 0 1.5px ${T.dot}` }}
      />
      <span>{T.label}</span>
      <span
        className={`text-[12px] font-semibold tabular-nums ${on ? 'text-ink-muted' : 'text-[#8d9b9d]'}`}
      >
        {count}
      </span>
    </button>
  );
}
