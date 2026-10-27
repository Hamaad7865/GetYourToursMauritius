'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LINE_TYPES,
  MONTHS,
  PEOPLE_TYPES,
  TIMELINE_END,
  TIMELINE_START,
  WEEKDAYS,
  dayNumber,
  durationLabel,
  hhmm,
  timelineBars,
  toMinutes,
  weekdayIndex,
  yearMonth,
  type CalLine,
} from '@/lib/admin/calendar-view';
import { AdminError } from '@/components/admin/ui';
import { BookingMovePicker, CallOffEditor, MoveDepartureEditor, TimeEditor } from './editors';
import { CustomPartyBlock, DeparturePartyBlock, ReturnLegPartyBlock } from './PartyBlock';
import { CalledOffTag, euros, FlagTag, Ic, ICON, QuoteTag } from './parts';

export type LineMode = 'time' | 'move' | 'calloff';

export interface PanelActions {
  /** Something changed on the server — reload, keep the panel where it is. */
  onChanged: () => void;
  /** Reload and confirm with a toast; `undo` reverses it, `showDay` jumps to another day. */
  onToast: (message: string, opts?: { undo?: () => Promise<void>; showDay?: string }) => void;
}

const TICKS = [6, 8, 10, 12, 14, 16, 18, 20];

export function DayPanel({
  day,
  today,
  nowMinutes,
  lines,
  loading,
  error,
  showMoney,
  expanded,
  onToggle,
  onPrev,
  onNext,
  onClose,
  actions,
  focusKey,
}: {
  day: string;
  today: string;
  nowMinutes: number;
  /** Every line on the day, unfiltered — the panel is the day's full picture. */
  lines: CalLine[];
  loading: boolean;
  error: string | null;
  showMoney: boolean;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  actions: PanelActions;
  /** A line just opened from the grid — scrolled into view. */
  focusKey: string | null;
}) {
  const [mode, setMode] = useState<{ key: string; kind: LineMode } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A different day starts with no editor open.
  useEffect(() => setMode(null), [day]);

  useEffect(() => {
    if (!focusKey || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-line="${focusKey}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusKey, lines]);

  // Esc closes an open editor first; the panel itself closes on the next Esc (handled by the page).
  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setMode(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mode]);

  const live = lines.filter((l) => !l.cancelled);
  const departures = live.filter((l) => PEOPLE_TYPES.has(l.type));
  const guests = departures.reduce((s, l) => s + l.guests, 0);
  const value = live.reduce((s, l) => s + l.valueEur, 0);
  const attention = lines.reduce((s, l) => s + l.flaggedParties, 0);
  const { bars, lanes } = timelineBars(lines);
  const span = TIMELINE_END - TIMELINE_START;
  const isToday = day === today;
  const nowLeft =
    isToday && nowMinutes >= TIMELINE_START && nowMinutes <= TIMELINE_END
      ? (nowMinutes - TIMELINE_START) / span
      : null;
  const [y, m0] = yearMonth(day);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-[#e9eeed] px-5 pb-4 pt-[18px] sm:pl-[22px]">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p
              className={`text-[12px] font-bold uppercase tracking-[0.14em] ${
                isToday ? 'text-teal-dark' : 'text-ink-muted'
              }`}
            >
              {WEEKDAYS[weekdayIndex(day)]}
              {isToday ? ' · Today' : ''}
            </p>
            <h2 className="mt-1.5 text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em] text-ink">
              {dayNumber(day)} {MONTHS[m0]} {y}
            </h2>
          </div>
          <div className="flex shrink-0 gap-1">
            <PanelButton title="Previous day (←)" onClick={onPrev} d={ICON.chevronLeft} />
            <PanelButton title="Next day (→)" onClick={onNext} d={ICON.chevronRight} />
            <PanelButton title="Close (Esc)" onClick={onClose} d={ICON.close} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          <Stat
            value={String(departures.length)}
            label={departures.length === 1 ? 'departure' : 'departures'}
          />
          <Stat value={String(guests)} label={guests === 1 ? 'guest' : 'guests'} />
          {showMoney && <Stat value={euros(value)} label="booked" />}
          {attention > 0 && (
            <span className="ml-auto flex h-7 items-center gap-1.5 rounded-full bg-[#fdf1de] px-2.5 text-[12.5px] font-semibold text-[#8f4c06]">
              <Ic d={ICON.alert} size={14} />
              {attention} to check
            </span>
          )}
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {bars.length > 0 && (
          <div className="px-[22px] pb-1 pt-4">
            <p className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink-muted">
              Day at a glance
            </p>
            <div className="relative rounded-lg bg-[#f5f8f7]" style={{ height: lanes * 10 + 8 }}>
              {TICKS.map((h) => (
                <span
                  key={h}
                  className="absolute inset-y-0 w-px bg-[#e3e9e8]"
                  style={{ left: `${((h * 60 - TIMELINE_START) / span) * 100}%` }}
                />
              ))}
              {bars.map((b) => (
                <span
                  key={b.key}
                  title={b.label}
                  className="absolute h-1.5 rounded-[3px]"
                  style={{
                    left: `${b.left * 100}%`,
                    width: `${b.width * 100}%`,
                    top: 6 + b.lane * 10,
                    background: LINE_TYPES[b.type].dot,
                  }}
                />
              ))}
              {nowLeft != null && (
                <span
                  title="Now"
                  className="absolute -bottom-[3px] -top-[3px] w-0.5 rounded-[1px] bg-[#d92d20]"
                  style={{ left: `${nowLeft * 100}%` }}
                />
              )}
            </div>
            <div className="relative mt-[5px] h-4">
              {TICKS.map((h) => (
                <span
                  key={h}
                  className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-[#6b7c7e]"
                  style={{ left: `${((h * 60 - TIMELINE_START) / span) * 100}%` }}
                >
                  {`${String(h).padStart(2, '0')}:00`}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5 pb-9 pl-3 pr-5 pt-3">
          {error && (
            <div className="pl-2.5">
              <AdminError>{error}</AdminError>
            </div>
          )}
          {loading && lines.length === 0 && (
            <p className="py-8 text-center text-[13.5px] text-ink-muted">Loading…</p>
          )}
          {lines.map((l) => (
            <LineCard
              key={l.key}
              line={l}
              today={today}
              showMoney={showMoney}
              expanded={expanded.has(l.key)}
              onToggle={() => {
                if (mode?.key === l.key) setMode(null);
                onToggle(l.key);
              }}
              mode={mode?.key === l.key ? mode.kind : null}
              setMode={(kind) => setMode(kind ? { key: l.key, kind } : null)}
              actions={actions}
            />
          ))}
          {!loading && !error && lines.length === 0 && (
            <div className="ml-2.5 mt-2 rounded-[14px] border border-dashed border-[#d3dcdb] px-5 py-7 text-center text-[13.5px] leading-[1.5] text-ink-muted">
              Nothing scheduled for this day.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PanelButton({ title, onClick, d }: { title: string; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-[#e3e9e8] bg-white text-[#3c5255] hover:bg-[#f3f6f5]"
    >
      <Ic d={d} size={16} />
    </button>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[22px] font-bold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-[5px] text-[12px] text-ink-muted">{label}</p>
    </div>
  );
}

/** "Tour · 8 h · 4 guests · €320" — what the line is, at a glance. */
function metaLine(l: CalLine, showMoney: boolean): string {
  const T = LINE_TYPES[l.type];
  const parts: string[] = [T.singular];
  if (l.subtitle && l.entry.kind === 'occurrence') parts.push(l.subtitle);
  if (l.durationMinutes) parts.push(durationLabel(l.durationMinutes));
  if (PEOPLE_TYPES.has(l.type)) {
    const g = l.guests;
    parts.push(`${g} guest${g === 1 ? '' : 's'}`);
    if (l.pendingGuests) parts.push(`+${l.pendingGuests} unpaid`);
  }
  if (l.entry.kind === 'occurrence') {
    const d = l.entry;
    if (d.guestsPerTrip) {
      const trips = Math.max(1, Math.round(d.capacity / d.guestsPerTrip));
      parts.push(`${Math.ceil(d.pax / d.guestsPerTrip)} of ${trips} trip${trips === 1 ? '' : 's'}`);
    } else parts.push(`${d.units} of ${d.capacity}`);
  }
  if (showMoney && l.valueEur > 0) parts.push(euros(l.valueEur));
  return parts.join(' · ');
}

function LineCard({
  line: l,
  today,
  showMoney,
  expanded,
  onToggle,
  mode,
  setMode,
  actions,
}: {
  line: CalLine;
  today: string;
  showMoney: boolean;
  expanded: boolean;
  onToggle: () => void;
  mode: LineMode | null;
  setMode: (kind: LineMode | null) => void;
  actions: PanelActions;
}) {
  const T = LINE_TYPES[l.type];
  const upcoming = l.day >= today;
  const dep = l.entry.kind === 'occurrence' ? l.entry : null;
  // A tour's time is its own to change; a transfer's is each guest's own flight or pickup.
  const canTime = dep != null && upcoming && !l.cancelled && l.type !== 'transfer';
  const canAct = dep != null && upcoming && !l.cancelled;
  const [movingRef, setMovingRef] = useState<string | null>(null);
  const timing = mode === 'time';
  const shownTime = l.time;
  const until =
    shownTime && l.durationMinutes ? `→ ${hhmm(toMinutes(shownTime) + l.durationMinutes)}` : '';
  const panelId = `line-${l.key}`;

  const startTime = () => {
    if (!expanded) onToggle();
    setMode(timing ? null : 'time');
  };

  return (
    <div data-line={l.key} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2.5">
      <div className="flex flex-col items-end pt-2">
        {canTime ? (
          <button
            type="button"
            onClick={startTime}
            title="Change time"
            aria-label={`Change start time (${shownTime ?? 'not set'})`}
            className={`-mr-1.5 flex flex-col items-end gap-[3px] rounded-lg px-1.5 py-[5px] transition-colors hover:bg-[#e7f4f3] ${
              timing ? 'bg-[#e7f4f3]' : ''
            }`}
          >
            <span
              className={`whitespace-nowrap border-b border-dashed border-[#9bbab7] text-[13px] font-bold leading-[1.2] tabular-nums ${
                timing ? 'text-teal-dark' : 'text-ink'
              }`}
            >
              {shownTime ?? 'TBC'}
            </span>
            <span className="whitespace-nowrap text-[11.5px] leading-[1.2] tabular-nums text-[#6b7c7e]">
              {until}
            </span>
          </button>
        ) : (
          <div className="flex flex-col items-end gap-[3px] pt-[5px]">
            <span className="whitespace-nowrap text-[13px] font-bold leading-[1.2] tabular-nums text-ink">
              {shownTime ?? (l.allDay ? 'All day' : 'TBC')}
            </span>
            <span className="whitespace-nowrap text-[11.5px] leading-[1.2] tabular-nums text-[#6b7c7e]">
              {until}
            </span>
          </div>
        )}
      </div>

      <div
        className={`min-w-0 overflow-hidden rounded-[14px] border bg-white transition-[box-shadow,border-color] duration-200 ${
          expanded
            ? 'border-[#c9dcda] shadow-[0_14px_30px_-20px_rgba(12,47,51,0.5)]'
            : 'border-[#e3e9e8]'
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex w-full flex-col gap-[7px] px-3.5 py-3 text-left hover:bg-[#fafcfc]"
        >
          <span className="flex items-start gap-2.5">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: T.dot }} />
            <span
              className={`min-w-0 flex-1 text-[14.5px] font-semibold leading-[1.35] ${
                l.cancelled ? 'text-[#6b7c7e] line-through' : 'text-ink'
              }`}
            >
              {l.title}
            </span>
            <Ic
              d={ICON.chevronDown}
              size={16}
              className={`mt-[3px] shrink-0 text-[#6b7c7e] transition-transform duration-200 ${
                expanded ? 'rotate-180' : ''
              }`}
            />
          </span>
          <span className="pl-[18px] text-[12.5px] tabular-nums text-ink-muted">
            {metaLine(l, showMoney)}
          </span>
          {(l.cancelled || l.flags.length > 0 || l.fromQuote || dep?.timeOverride) && (
            <span className="flex flex-wrap gap-1.5 pl-[18px]">
              {l.cancelled && <CalledOffTag />}
              {l.flags.map((f) => (
                <FlagTag key={f}>{f}</FlagTag>
              ))}
              {dep?.timeOverride && !l.cancelled && (
                <span className="inline-flex h-[22px] items-center rounded-md bg-[#e7f4f3] px-2 text-[12px] font-semibold text-teal-dark">
                  Time changed{dep.tourTime ? ` · usually ${dep.tourTime}` : ''}
                </span>
              )}
              {l.fromQuote && <QuoteTag />}
            </span>
          )}
          {!expanded && l.leadName && (
            <span className="flex min-w-0 items-center gap-1.5 pl-[18px] text-[12.5px]">
              <span className="max-w-[55%] shrink-0 truncate font-semibold text-[#3c5255]">
                {l.leadName}
                {l.parties > 1 ? ` + ${l.parties - 1} more` : ''}
              </span>
              {l.where && (
                <>
                  <span className="text-[#9aa8a9]">·</span>
                  <span
                    className={`min-w-0 truncate ${
                      l.whereMissing ? 'text-[#a15c07]' : 'text-ink-muted'
                    }`}
                  >
                    {l.where}
                  </span>
                </>
              )}
            </span>
          )}
        </button>

        {expanded && (
          <div id={panelId} className="border-t border-[#e9eeed] bg-[#fafcfb]">
            {timing && dep && (
              <TimeEditor
                departure={dep}
                title={l.title}
                onCancel={() => setMode(null)}
                onSaved={(message, undo) => {
                  setMode(null);
                  actions.onToast(message, { undo });
                }}
              />
            )}

            {dep &&
              dep.bookings.map((b) => (
                <DeparturePartyBlock
                  key={b.id}
                  booking={b}
                  departure={dep}
                  type={l.type}
                  flags={l.partyFlags[b.id] ?? []}
                  money={showMoney}
                  upcoming={upcoming}
                  footerAction={
                    canAct && b.reschedulable ? (
                      <button
                        type="button"
                        onClick={() => setMovingRef(movingRef === b.ref ? null : b.ref)}
                        className="text-[13px] font-semibold text-teal-dark hover:text-ink"
                      >
                        {movingRef === b.ref ? 'Cancel move' : 'Move this booking'}
                      </button>
                    ) : null
                  }
                >
                  {movingRef === b.ref && (
                    <BookingMovePicker
                      bookingRef={b.ref}
                      activityOptionId={dep.activityOptionId}
                      excludeOccurrenceId={dep.occurrenceId}
                      onDone={(message, toDay) => {
                        setMovingRef(null);
                        actions.onToast(message, { showDay: toDay });
                      }}
                    />
                  )}
                </DeparturePartyBlock>
              ))}
            {l.entry.kind === 'custom' && (
              <CustomPartyBlock
                line={l.entry}
                type={l.type}
                flags={l.partyFlags[l.entry.bookingId] ?? []}
                money={showMoney}
                upcoming={upcoming}
              />
            )}
            {l.entry.kind === 'return-leg' && (
              <ReturnLegPartyBlock
                leg={l.entry}
                flags={l.partyFlags[l.entry.bookingId] ?? []}
                money={showMoney}
                upcoming={upcoming}
              />
            )}

            {canAct && mode !== 'move' && mode !== 'calloff' && (
              <div className="flex flex-wrap gap-2 px-3.5 py-3">
                {canTime && (
                  <button
                    type="button"
                    onClick={startTime}
                    className={`inline-flex h-[34px] items-center gap-[7px] rounded-[9px] border px-3 text-[13px] font-semibold text-ink hover:bg-[#f3f6f5] ${
                      timing ? 'border-[#9fcfca] bg-[#e7f4f3]' : 'border-[#d6dfde] bg-white'
                    }`}
                  >
                    <Ic d={ICON.clock} size={15} stroke={1.9} />
                    Change time
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMode('move')}
                  className="inline-flex h-[34px] items-center gap-[7px] rounded-[9px] border border-[#d6dfde] bg-white px-3 text-[13px] font-semibold text-ink hover:bg-[#f3f6f5]"
                >
                  <Ic d={ICON.move} size={15} stroke={1.9} />
                  Move to another day
                </button>
                <button
                  type="button"
                  onClick={() => setMode('calloff')}
                  className="inline-flex h-[34px] items-center gap-[7px] rounded-[9px] border border-[#f1d0cc] bg-white px-3 text-[13px] font-semibold text-[#b42318] hover:bg-[#fdf3f2]"
                >
                  <Ic d={ICON.callOff} size={15} stroke={1.9} />
                  Call off
                </button>
              </div>
            )}

            {mode === 'move' && dep && (
              <MoveDepartureEditor
                departure={dep}
                today={today}
                onCancel={() => setMode(null)}
                onMoved={(message, toDay) => {
                  setMode(null);
                  actions.onToast(message, { showDay: toDay });
                }}
              />
            )}

            {mode === 'calloff' && dep && (
              <CallOffEditor
                departure={dep}
                onCancel={() => setMode(null)}
                onDone={(message) => {
                  setMode(null);
                  actions.onToast(message);
                }}
              />
            )}

            {l.cancelled && (
              <p className="px-3.5 py-3 text-[12.5px] text-ink-muted">
                This departure was called off. Guests who were paid choose a new date or a refund.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
