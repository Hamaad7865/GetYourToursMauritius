'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { monthCells } from '@/lib/calendar/month';
import { nominalDayKey } from '@/lib/services/day-key';
import { useDialog } from '@/lib/a11y/useDialog';
import { AdminHeading, AdminError, BTN_GHOST, SELECT_CLS } from './ui';
import {
  CALL_OFF_REASONS,
  callOffDeparture,
  loadCalendarMonth,
  loadDaySchedule,
  loadMoveTargets,
  rescheduleBookingAsStaff,
  type CalendarDay,
  type CallOffReason,
  type DayDeparture,
  type MoveTarget,
} from '@/lib/admin/calendar';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function dayLabel(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Indian/Mauritius',
  });
}

/**
 * Month grid for the operations calendar.
 *
 * Built on the shared `monthCells()` rather than reusing the customer MonthGrid: that one disables
 * unavailable cells (an operator must be able to open a day with no departures), pins a `tomorrow`
 * lower bound (an operator looks backwards), and renders only a number with no room for a load
 * summary. Sharing the maths and writing our own cells is the pattern TripDatePicker already follows.
 */
function AdminMonthGrid({
  month,
  byDay,
  selected,
  onPick,
}: {
  month: Date;
  byDay: Map<string, CalendarDay>;
  selected: string | null;
  onPick: (key: string) => void;
}) {
  const cells = monthCells(month.getFullYear(), month.getMonth());
  const todayKey = nominalDayKey(new Date());
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[11px] font-bold text-ink-muted">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} />;
          const key = nominalDayKey(cell);
          const info = byDay.get(key);
          const isToday = key === todayKey;
          const isSelected = key === selected;
          const calledOff = (info?.cancelled ?? 0) > 0;
          const full = info && info.departures > 0 && info.seatsLeft === 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              aria-pressed={isSelected}
              aria-label={`${dayLabel(key)} — ${info?.departures ?? 0} departures, ${info?.pax ?? 0} guests${calledOff ? ', has a called-off departure' : ''}`}
              className={`min-h-[64px] rounded-xl border p-1.5 text-left transition ${
                isSelected
                  ? 'border-teal bg-teal/10'
                  : calledOff
                    ? 'border-coral/40 bg-coral/[0.06] hover:border-coral/60'
                    : 'border-[#EAEEF0] bg-white hover:border-teal/40 hover:bg-teal/[0.04]'
              }`}
            >
              <span className={`text-[12.5px] font-bold ${isToday ? 'text-teal' : 'text-ink'}`}>
                {cell.getDate()}
              </span>
              {info && info.departures > 0 && (
                <span className="mt-0.5 block text-[10.5px] leading-tight text-ink-muted">
                  <span className="font-bold text-ink/80">{info.departures}</span> dep
                  {info.pax > 0 && (
                    <>
                      {' · '}
                      <span className="font-bold text-ink/80">{info.pax}</span> pax
                    </>
                  )}
                  {calledOff && <span className="block font-bold text-coral">called off</span>}
                  {full && !calledOff && <span className="block font-bold text-ink/70">full</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdminCalendar() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [byDay, setByDay] = useState<Map<string, CalendarDay>>(new Map());
  const [monthError, setMonthError] = useState<string | null>(null);
  const [loadingMonth, setLoadingMonth] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const from = useMemo(
    () => nominalDayKey(new Date(month.getFullYear(), month.getMonth(), 1)),
    [month],
  );
  const to = useMemo(
    () => nominalDayKey(new Date(month.getFullYear(), month.getMonth() + 1, 0)),
    [month],
  );

  useEffect(() => {
    let active = true;
    setLoadingMonth(true);
    setMonthError(null);
    loadCalendarMonth(from, to)
      .then((rows) => {
        if (!active) return;
        setByDay(new Map(rows.map((r) => [r.day, r])));
      })
      .catch((e: unknown) => {
        if (!active) return;
        setMonthError(e instanceof Error ? e.message : 'Could not load the calendar.');
      })
      .finally(() => {
        if (active) setLoadingMonth(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="pb-16">
      <AdminHeading
        title="Calendar"
        subtitle="Every departure, day by day. Open a day to see who is booked — and to call a departure off."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className={BTN_GHOST}
              aria-label="Previous month"
            >
              ←
            </button>
            <span className="min-w-[9.5rem] text-center text-sm font-bold text-ink">
              {monthLabel(month)}
            </span>
            <button
              type="button"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className={BTN_GHOST}
              aria-label="Next month"
            >
              →
            </button>
          </div>
        }
      />

      {monthError && <AdminError>{monthError}</AdminError>}

      <div className="rounded-2xl border border-[#EAEEF0] bg-white p-3.5 sm:p-5">
        {loadingMonth ? (
          <p className="py-16 text-center text-sm text-ink-muted">Loading…</p>
        ) : (
          <AdminMonthGrid month={month} byDay={byDay} selected={selected} onPick={setSelected} />
        )}
      </div>

      {selected && (
        <DayDrawer day={selected} onClose={() => setSelected(null)} onChanged={refresh} />
      )}
    </div>
  );
}

function DayDrawer({
  day,
  onClose,
  onChanged,
}: {
  day: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const panelRef = useDialog(true, onClose);
  const [departures, setDepartures] = useState<DayDeparture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    loadDaySchedule(day)
      .then((rows) => active && setDepartures(rows))
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Could not load this day.');
        setDepartures([]);
      });
    return () => {
      active = false;
    };
  }, [day, reloadKey]);

  const reload = useCallback(() => {
    setDepartures(null);
    setReloadKey((k) => k + 1);
    onChanged();
  }, [onChanged]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/25"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Departures on ${dayLabel(day)}`}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[#EAEEF0] bg-white px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">{dayLabel(day)}</h2>
            {departures && (
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                {departures.length} departure{departures.length === 1 ? '' : 's'} ·{' '}
                {departures.reduce((s, d) => s + d.pax, 0)} guests
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Close
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          {error && <AdminError>{error}</AdminError>}
          {departures === null && <p className="text-sm text-ink-muted">Loading…</p>}
          {departures?.length === 0 && !error && (
            <p className="py-10 text-center text-sm text-ink-muted">
              Nothing is running on this day.
            </p>
          )}
          {departures?.map((d) => (
            <DepartureCard key={d.occurrenceId} departure={d} onChanged={reload} />
          ))}
        </div>
      </aside>
    </div>
  );
}

function DepartureCard({
  departure,
  onChanged,
}: {
  departure: DayDeparture;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<CallOffReason>('weather');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movingRef, setMovingRef] = useState<string | null>(null);
  const calledOff = departure.status === 'cancelled';

  const callOff = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await callOffDeparture(departure.occurrenceId, reason);
      setConfirming(false);
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not call this departure off.');
    } finally {
      setBusy(false);
    }
  }, [departure.occurrenceId, reason, onChanged]);

  return (
    <div
      className={`rounded-2xl border p-4 ${calledOff ? 'border-coral/40 bg-coral/[0.05]' : 'border-[#EAEEF0] bg-white'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink">{departure.activityTitle}</p>
          <p className="text-[12.5px] text-ink-muted">
            {departure.optionName} · {timeLabel(departure.startsAt)} · {departure.pax} of{' '}
            {departure.capacity}
          </p>
        </div>
        {calledOff && (
          <span className="shrink-0 rounded-full bg-coral/15 px-2.5 py-1 text-[11px] font-bold text-coral">
            Called off
          </span>
        )}
      </div>

      {departure.bookings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-[#F2F4F6] pt-3">
          {departure.bookings.map((b) => (
            <li key={b.ref} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="truncate text-ink">
                <span className="font-bold">{b.ref}</span> · {b.customerName || 'Guest'} · {b.pax}{' '}
                pax
              </span>
              {!calledOff && (
                <button
                  type="button"
                  onClick={() => setMovingRef(movingRef === b.ref ? null : b.ref)}
                  className="shrink-0 font-bold text-teal underline underline-offset-2"
                >
                  {movingRef === b.ref ? 'Cancel' : 'Move'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {movingRef && (
        <MovePicker
          bookingRef={movingRef}
          activityOptionId={departure.activityOptionId}
          excludeOccurrenceId={departure.occurrenceId}
          onDone={() => {
            setMovingRef(null);
            onChanged();
          }}
        />
      )}

      {error && <AdminError>{error}</AdminError>}

      {!calledOff && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-full border border-coral/40 px-4 py-2 text-[12.5px] font-bold text-coral hover:bg-coral/5"
        >
          Call off this departure
        </button>
      )}

      {!calledOff && confirming && (
        <div className="mt-3 rounded-xl border border-coral/30 bg-coral/[0.06] p-3.5">
          <label className="block text-[12.5px] font-bold text-ink" htmlFor="reason">
            Why?
          </label>
          <select
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as CallOffReason)}
            className={`${SELECT_CLS} mt-1`}
          >
            {CALL_OFF_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {/* State the blast radius plainly: this mails guests immediately and cannot be undone
              from here, because some will have taken a refund before an undo could land. */}
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink/80">
            This emails{' '}
            <strong>
              {departure.bookings.length} guest{departure.bookings.length === 1 ? '' : 's'}
            </strong>{' '}
            straight away asking them to pick a new date or take a refund, and closes the date to
            new bookings. <strong>It cannot be undone from here.</strong>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void callOff()}
              className="rounded-full bg-coral px-4 py-2 text-[12.5px] font-bold text-white hover:bg-coral/90 disabled:opacity-60"
            >
              {busy ? 'Calling off…' : 'Yes, call it off'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className={BTN_GHOST}
            >
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MovePicker({
  bookingRef,
  activityOptionId,
  excludeOccurrenceId,
  onDone,
}: {
  bookingRef: string;
  activityOptionId: string;
  excludeOccurrenceId: string;
  onDone: () => void;
}) {
  const [targets, setTargets] = useState<MoveTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    loadMoveTargets(activityOptionId, excludeOccurrenceId)
      .then((rows) => mounted.current && setTargets(rows.slice(0, 12)))
      .catch((e: unknown) => {
        if (!mounted.current) return;
        setError(e instanceof Error ? e.message : 'Could not load dates.');
        setTargets([]);
      });
    return () => {
      mounted.current = false;
    };
  }, [activityOptionId, excludeOccurrenceId]);

  const move = useCallback(
    async (occurrenceId: string) => {
      setBusy(occurrenceId);
      setError(null);
      try {
        await rescheduleBookingAsStaff(bookingRef, occurrenceId);
        onDone();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not move that booking.');
      } finally {
        setBusy(null);
      }
    },
    [bookingRef, onDone],
  );

  return (
    <div className="mt-2.5 rounded-xl border border-[#EAEEF0] bg-[#FAFBFC] p-3">
      <p className="text-[12.5px] font-bold text-ink">Move {bookingRef} to…</p>
      {error && <AdminError>{error}</AdminError>}
      {targets === null && <p className="mt-1 text-[12.5px] text-ink-muted">Loading dates…</p>}
      {targets?.length === 0 && !error && (
        <p className="mt-1 text-[12.5px] text-ink-muted">No other open dates for this option.</p>
      )}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {targets?.map((tgt) => (
          <button
            key={tgt.occurrenceId}
            type="button"
            disabled={busy != null}
            aria-busy={busy === tgt.occurrenceId}
            onClick={() => void move(tgt.occurrenceId)}
            className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-[12px] font-bold text-ink hover:border-teal/50 hover:bg-teal/5 disabled:opacity-60"
          >
            {new Date(tgt.startsAt).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
            })}
            <span className="ml-1 font-normal text-ink-muted">({tgt.seatsLeft})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
