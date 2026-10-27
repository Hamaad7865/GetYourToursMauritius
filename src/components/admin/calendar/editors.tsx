'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CALL_OFF_REASONS,
  callOffDeparture,
  describeRescheduleError,
  describeTimeError,
  loadMoveTargets,
  notifiableCount,
  rescheduleBookingAsStaff,
  setDepartureTime,
  type CallOffReason,
  type DayDeparture,
  type MoveTarget,
  type RescheduleFailure,
} from '@/lib/admin/calendar';
import {
  durationLabel,
  hhmm,
  movePickerDays,
  shiftLabel,
  shortDay,
  timePresets,
  timeWarning,
  toMinutes,
  WEEKDAYS,
  dayNumber,
  MONTHS,
  yearMonth,
  type PickerDay,
} from '@/lib/admin/calendar-view';
import { mauritiusDayKey } from '@/lib/admin/calendar';
import { fmtDateShort } from '@/lib/admin/format';
import { Ic, ICON } from './parts';

const BTN =
  'inline-flex h-[34px] items-center gap-[7px] rounded-[9px] border border-[#d6dfde] bg-white px-3 text-[13px] font-semibold text-ink hover:bg-[#f3f6f5] disabled:opacity-50';
const BTN_PRIMARY =
  'inline-flex h-[34px] items-center rounded-[9px] bg-teal px-3.5 text-[13px] font-semibold text-white hover:bg-teal-dark disabled:cursor-default disabled:opacity-45';

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-[12.5px] font-semibold text-[#b42318]">
      {children}
    </p>
  );
}

// ── Change time ─────────────────────────────────────────────────────────────────────────────────

/**
 * Set the time ONE departure leaves at. It overrides the tour's start time for this day only, on every
 * surface — and, unlike the prototype's version, it moves no pickup times: a tour booking stores none.
 * Guests are not told automatically, so the panel says so.
 */
export function TimeEditor({
  departure,
  title,
  onCancel,
  onSaved,
}: {
  departure: DayDeparture;
  title: string;
  onCancel: () => void;
  onSaved: (message: string, undo: () => Promise<void>) => void;
}) {
  const current = departure.departureTime;
  const usual = departure.tourTime;
  const startFrom = toMinutes(current ?? usual ?? '09:00');
  const [value, setValue] = useState(startFrom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const duration = departure.durationMinutes;
  const changed = current == null || value !== toMinutes(current);
  const presetsAround = toMinutes(usual ?? current ?? '09:00');
  const warn = timeWarning(value, duration);
  const clamp = (m: number) => Math.max(0, Math.min(23 * 60 + 55, m));

  const save = useCallback(
    async (time: string | null) => {
      setBusy(true);
      setError(null);
      const previous = departure.timeOverride;
      try {
        await setDepartureTime(departure.occurrenceId, time);
        const now = time ?? usual;
        onSaved(
          time
            ? `“${clip(title, 30)}” now leaves at ${time}`
            : `“${clip(title, 30)}” is back to its usual ${now ?? 'time'}`,
          async () => {
            await setDepartureTime(departure.occurrenceId, previous);
          },
        );
      } catch (e: unknown) {
        setError(describeTimeError(e));
      } finally {
        setBusy(false);
      }
    },
    [departure.occurrenceId, departure.timeOverride, onSaved, title, usual],
  );

  const summary =
    current && value !== toMinutes(current)
      ? `${hhmm(value)}${duration ? ` → ${hhmm(value + duration)}` : ''} · ${shiftLabel(
          value - toMinutes(current),
        )} than ${current}`
      : `Starts ${hhmm(value)}${duration ? `, finishes ${hhmm(value + duration)}` : ''}${
          duration ? ` (${durationLabel(duration)})` : ''
        }.`;

  return (
    <div className="flex flex-col gap-3 border-b border-[#dcebe9] bg-[#f3f9f8] p-3.5">
      <span className="text-[13.5px] font-semibold text-ink">Change start time</span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setValue((v) => clamp(v - 15))}
          title="15 minutes earlier"
          className="h-10 shrink-0 rounded-[9px] border border-[#d6dfde] bg-white px-3 text-[13px] font-semibold tabular-nums text-ink hover:bg-[#eef5f4]"
        >
          −15 min
        </button>
        <input
          type="time"
          step={300}
          value={hhmm(value)}
          onChange={(e) => {
            if (/^\d{2}:\d{2}$/.test(e.target.value)) setValue(toMinutes(e.target.value));
          }}
          aria-label="Start time"
          className="h-10 min-w-0 flex-1 rounded-[9px] border border-teal bg-white px-2.5 text-[17px] font-bold tabular-nums text-ink shadow-[0_0_0_3px_rgb(var(--color-teal)/0.14)] outline-none"
        />
        <button
          type="button"
          onClick={() => setValue((v) => clamp(v + 15))}
          title="15 minutes later"
          className="h-10 shrink-0 rounded-[9px] border border-[#d6dfde] bg-white px-3 text-[13px] font-semibold tabular-nums text-ink hover:bg-[#eef5f4]"
        >
          +15 min
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {timePresets(presetsAround).map((m) => {
          const on = m === value;
          const isUsual = usual != null && m === toMinutes(usual);
          return (
            <button
              key={m}
              type="button"
              onClick={() => setValue(m)}
              className={`h-[30px] rounded-full border px-2.5 text-[12.5px] font-semibold tabular-nums hover:border-teal ${
                on ? 'border-teal bg-teal text-white' : 'border-[#d6dfde] bg-white text-ink'
              }`}
            >
              {hhmm(m)}
              {isUsual ? ' (usual)' : ''}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-[5px] text-[12.5px] leading-[1.45]">
        <span className="tabular-nums text-[#3c5255]">{summary}</span>
        {warn && (
          <span className="flex items-start gap-1.5 font-semibold text-[#8f4c06]">
            <Ic d={ICON.alert} size={13} stroke={2.2} className="mt-[3px] shrink-0" />
            <span>{warn}</span>
          </span>
        )}
        <span className="text-ink-muted">
          This day only. Guests aren’t told automatically — let them know.
        </span>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {departure.timeOverride && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(null)}
            className="mr-auto text-[13px] font-semibold text-teal-dark underline-offset-2 hover:underline disabled:opacity-50"
          >
            Back to usual{usual ? ` (${usual})` : ''}
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={busy} className={BTN}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save(hhmm(value))}
          disabled={busy || !changed}
          className={BTN_PRIMARY}
        >
          {busy ? 'Saving…' : 'Save time'}
        </button>
      </div>
    </div>
  );
}

function clip(t: string, n: number): string {
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// ── Move the whole departure ────────────────────────────────────────────────────────────────────

interface MoveResult {
  moved: string[];
  failed: Array<{ ref: string; failure: RescheduleFailure }>;
}

/**
 * Move every paid party on a departure to the same option on another day. Each party is a real
 * reschedule (api_reschedule_booking), so each guest is emailed the new date — which is also why there
 * is no Undo: moving them back would email them all again. Unpaid parties hold no seat and stay put.
 */
export function MoveDepartureEditor({
  departure,
  today,
  onCancel,
  onMoved,
}: {
  departure: DayDeparture;
  today: string;
  onCancel: () => void;
  onMoved: (message: string, toDay: string) => void;
}) {
  const movable = departure.bookings.filter((b) => b.reschedulable);
  const staying = departure.bookings.length - movable.length;
  const units = movable.reduce((s, b) => s + b.lines.reduce((t, l) => t + l.quantity, 0), 0);
  const guests = movable.reduce((s, b) => s + b.pax, 0);
  const day = mauritiusDayKey(departure.startsAt);
  const [days, setDays] = useState<PickerDay[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<PickerDay | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MoveResult | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    // Every open day of the option, full or not — the picker says WHY a day cannot take them.
    loadMoveTargets(departure.activityOptionId, departure.occurrenceId, 0, 120)
      .then((targets) => live.current && setDays(movePickerDays(day, today, targets, units)))
      .catch((e: unknown) => {
        if (!live.current) return;
        setLoadError(e instanceof Error ? e.message : 'Could not load the days.');
        setDays([]);
      });
    return () => {
      live.current = false;
    };
  }, [departure.activityOptionId, departure.occurrenceId, day, today, units]);

  const run = useCallback(
    async (target: MoveTarget, refs: string[], staffOverride: boolean) => {
      setBusy(true);
      const moved: string[] = [];
      const failed: MoveResult['failed'] = [];
      // One at a time: each is its own transaction, and a capacity refusal on one should not race the rest.
      for (const ref of refs) {
        try {
          await rescheduleBookingAsStaff(ref, target.occurrenceId, { staffOverride });
          moved.push(ref);
        } catch (e: unknown) {
          failed.push({ ref, failure: describeRescheduleError(e) });
        }
      }
      if (!live.current) return;
      setBusy(false);
      const toDay = mauritiusDayKey(target.startsAt);
      if (failed.length === 0) {
        onMoved(
          `Moved ${moved.length} booking${moved.length === 1 ? '' : 's'} to ${shortDay(toDay)}. ${
            moved.length === 1 ? 'The guest is' : 'Each guest is'
          } emailed the new date.`,
          toDay,
        );
        return;
      }
      setResult((prev) => ({
        moved: [...(prev?.moved ?? []), ...moved],
        failed,
      }));
    },
    [onMoved],
  );

  if (movable.length === 0) {
    return (
      <div className="flex flex-col gap-2.5 bg-[#f3f9f8] p-3.5">
        <p className="text-[13px] text-[#3c5255]">
          Nobody on this departure can be moved yet — only paid bookings hold a seat to move.
        </p>
        <div className="flex justify-end">
          <button type="button" onClick={onCancel} className={BTN}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const windowRefs = result?.failed.filter((f) => f.failure.windowBlocked).map((f) => f.ref) ?? [];

  return (
    <div className="flex flex-col gap-2.5 bg-[#f3f9f8] p-3.5">
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-[13.5px] font-semibold text-ink">Move to which day?</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-7 rounded-lg px-2.5 text-[13px] font-semibold text-[#3c5255] hover:bg-[#e3efed]"
        >
          Cancel
        </button>
      </div>

      {loadError && <ErrorLine>{loadError}</ErrorLine>}
      {days === null && <p className="text-[12.5px] text-ink-muted">Loading days…</p>}

      {days && !pick && (
        <>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d, i) => (
              <button
                key={d.day}
                type="button"
                disabled={d.disabled}
                onClick={() => setPick(d)}
                title={`${shortDay(d.day)}${d.reason ? ` · ${d.reason}` : d.seatsLeft != null ? ` · ${d.seatsLeft} free` : ''}`}
                className={`flex h-[52px] min-w-0 flex-col items-center justify-center gap-px rounded-lg border p-0 ${
                  d.current
                    ? 'border-teal bg-[#e3f2f0] text-ink'
                    : d.past
                      ? 'border-[#dbe3e2] bg-[#f1f4f4] text-[#a3b0b1]'
                      : d.disabled
                        ? 'border-[#dbe3e2] bg-white text-[#a3b0b1]'
                        : 'border-[#dbe3e2] bg-white text-ink hover:border-teal'
                }`}
              >
                <span className="text-[10.5px] font-semibold opacity-75">
                  {WEEKDAYS[i % 7]!.slice(0, 2)}
                </span>
                <span className="whitespace-nowrap text-[13px] font-bold tabular-nums">
                  {dayNumber(d.day) === 1
                    ? `1 ${MONTHS[yearMonth(d.day)[1]]!.slice(0, 3)}`
                    : dayNumber(d.day)}
                </span>
                <span className="text-[10.5px] font-semibold tabular-nums text-[#6b7c7e]">
                  {!d.past && !d.current && d.seatsLeft != null ? d.seatsLeft : ''}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[12px] text-ink-muted">
            The small number under each day is the seats still free on this tour.
          </p>
        </>
      )}

      {pick?.target && !result && (
        <div className="flex flex-col gap-2.5">
          <p className="text-[13px] leading-[1.5] text-[#3c5255]">
            Move{' '}
            <strong className="text-ink">
              {movable.length} booking{movable.length === 1 ? '' : 's'} ({guests} guest
              {guests === 1 ? '' : 's'})
            </strong>{' '}
            to <strong className="text-ink">{shortDay(pick.day)}</strong>?{' '}
            {movable.length === 1 ? 'The guest is' : 'Each guest is'} emailed the new date.
            {staying > 0 &&
              ` ${staying} unpaid booking${staying === 1 ? ' stays' : 's stay'} on ${shortDay(day)}.`}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPick(null)} disabled={busy} className={BTN}>
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  pick.target!,
                  movable.map((b) => b.ref),
                  false,
                )
              }
              className={BTN_PRIMARY}
            >
              {busy ? 'Moving…' : `Move to ${shortDay(pick.day)}`}
            </button>
          </div>
        </div>
      )}

      {result && pick?.target && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-[#f0cf9a] bg-[#fff7ea] p-3 text-[12.5px] leading-[1.5]">
          {result.moved.length > 0 && (
            <p className="text-ink">
              Moved {result.moved.join(', ')} to {shortDay(pick.day)}.
            </p>
          )}
          {result.failed.map((f) => (
            <p key={f.ref} className="text-[#8f4c06]">
              <strong>{f.ref}</strong>: {f.failure.message}
            </p>
          ))}
          <div className="flex flex-wrap justify-end gap-2">
            {windowRefs.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(pick.target!, windowRefs, true)}
                className="inline-flex h-[34px] items-center rounded-[9px] bg-amber-500 px-3.5 text-[13px] font-semibold text-white hover:bg-amber-500/90 disabled:opacity-60"
              >
                {busy ? 'Moving…' : `Move ${windowRefs.length === 1 ? 'it' : 'them'} anyway`}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onMoved(
                  `Moved ${result.moved.length} of ${movable.length} bookings to ${shortDay(pick.day)}.`,
                  mauritiusDayKey(pick.target!.startsAt),
                )
              }
              className={BTN}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Call off ────────────────────────────────────────────────────────────────────────────────────

/**
 * Call a departure off. Unchanged rules: it emails every paid guest straight away asking them to pick a
 * new date or take a refund, so it cannot be undone from here — the panel says exactly who is emailed.
 */
export function CallOffEditor({
  departure,
  onCancel,
  onDone,
}: {
  departure: DayDeparture;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState<CallOffReason>('weather');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Not bookings.length: the fan-out skips completed, unpaid and already-disrupted parties.
  const willEmail = notifiableCount(departure);
  const day = mauritiusDayKey(departure.startsAt);

  const callOff = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await callOffDeparture(departure.occurrenceId, reason);
      onDone(
        willEmail > 0
          ? `Called off. ${willEmail} guest${willEmail === 1 ? ' is' : 's are'} being emailed.`
          : 'Departure called off.',
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not call this departure off.');
      setBusy(false);
    }
  }, [departure.occurrenceId, reason, willEmail, onDone]);

  return (
    <div className="flex flex-col gap-2.5 bg-[#fdf6f5] p-3.5">
      <p className="text-[14px] font-semibold text-[#8a1c12]">Call off this departure?</p>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-[#3d2a28]">
        Why?
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as CallOffReason)}
          className="h-[34px] cursor-pointer rounded-[9px] border border-[#e6d3d0] bg-white px-2.5 text-[13px] font-medium text-ink outline-none focus:border-[#b42318]"
        >
          {CALL_OFF_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[13px] leading-[1.5] text-[#5b3a36]">
        {willEmail > 0 ? (
          <>
            This emails{' '}
            <strong>
              {willEmail} paid guest{willEmail === 1 ? '' : 's'}
            </strong>{' '}
            straight away asking them to pick a new date or take a refund, and closes{' '}
            {fmtDateShort(departure.startsAt)} to new bookings.
          </>
        ) : (
          <>
            This closes {shortDay(day)} to new bookings. <strong>Nobody is emailed</strong> — no
            paid guest on this departure is waiting on an answer.
          </>
        )}{' '}
        <strong>It cannot be undone from here.</strong>
      </p>
      {error && <ErrorLine>{error}</ErrorLine>}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex h-[34px] items-center rounded-[9px] border border-[#e6d3d0] bg-white px-3 text-[13px] font-semibold text-[#3d2a28] hover:bg-[#faf1f0] disabled:opacity-50"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={() => void callOff()}
          disabled={busy}
          aria-busy={busy}
          className="inline-flex h-[34px] items-center rounded-[9px] bg-[#b42318] px-3.5 text-[13px] font-semibold text-white hover:bg-[#9a1d13] disabled:opacity-60"
        >
          {busy ? 'Calling off…' : 'Call off departure'}
        </button>
      </div>
    </div>
  );
}

// ── Move one booking ────────────────────────────────────────────────────────────────────────────

/** Move ONE party to another departure of the same option, with the 24h "move anyway" override. */
export function BookingMovePicker({
  bookingRef,
  activityOptionId,
  excludeOccurrenceId,
  onDone,
}: {
  bookingRef: string;
  activityOptionId: string;
  excludeOccurrenceId: string;
  onDone: (message: string, toDay: string) => void;
}) {
  const [targets, setTargets] = useState<MoveTarget[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failure, setFailure] = useState<RescheduleFailure | null>(null);
  // The one date the RPC refused ONLY on the 24h window — "Move anyway" re-sends that target alone.
  const [pendingOverride, setPendingOverride] = useState<MoveTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    loadMoveTargets(activityOptionId, excludeOccurrenceId)
      .then((rows) => live.current && setTargets(rows.slice(0, 12)))
      .catch((e: unknown) => {
        if (!live.current) return;
        setLoadError(e instanceof Error ? e.message : 'Could not load dates.');
        setTargets([]);
      });
    return () => {
      live.current = false;
    };
  }, [activityOptionId, excludeOccurrenceId]);

  const move = useCallback(
    async (tgt: MoveTarget, staffOverride: boolean) => {
      setBusy(tgt.occurrenceId);
      setFailure(null);
      setPendingOverride(null);
      try {
        await rescheduleBookingAsStaff(bookingRef, tgt.occurrenceId, { staffOverride });
        const toDay = mauritiusDayKey(tgt.startsAt);
        onDone(
          `Moved ${bookingRef} to ${shortDay(toDay)}. The guest is emailed the new date.`,
          toDay,
        );
      } catch (e: unknown) {
        const f = describeRescheduleError(e);
        setFailure(f);
        // Only the 24h window is retryable, and only once.
        if (f.windowBlocked && !staffOverride) setPendingOverride(tgt);
      } finally {
        if (live.current) setBusy(null);
      }
    },
    [bookingRef, onDone],
  );

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[#e3e9e8] bg-[#fafcfb] p-3">
      <p className="text-[12.5px] font-bold text-ink">Move {bookingRef} to…</p>
      {loadError && <ErrorLine>{loadError}</ErrorLine>}
      {failure && !pendingOverride && <ErrorLine>{failure.message}</ErrorLine>}
      {targets === null && <p className="text-[12.5px] text-ink-muted">Loading dates…</p>}
      {targets?.length === 0 && !loadError && (
        <p className="text-[12.5px] text-ink-muted">No other open dates for this option.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {targets?.map((tgt) => (
          <button
            key={tgt.occurrenceId}
            type="button"
            disabled={busy != null}
            aria-busy={busy === tgt.occurrenceId}
            onClick={() => void move(tgt, false)}
            className="rounded-full border border-[#d6dfde] bg-white px-3 py-1.5 text-[12px] font-bold text-ink hover:border-teal disabled:opacity-60"
          >
            {fmtDateShort(tgt.startsAt)}
            <span className="ml-1 font-normal text-ink-muted">({tgt.seatsLeft})</span>
          </button>
        ))}
      </div>
      {pendingOverride && (
        <div className="rounded-[10px] border border-amber-300 bg-amber-50/60 p-3">
          <p className="text-[12.5px] leading-relaxed text-ink">
            {failure?.message} Move <strong>{bookingRef}</strong> to{' '}
            <strong>{fmtDateShort(pendingOverride.startsAt)}</strong> anyway?
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void move(pendingOverride, true)}
              className="rounded-full bg-amber-500 px-4 py-1.5 text-[12px] font-bold text-white hover:bg-amber-500/90 disabled:opacity-60"
            >
              {busy ? 'Moving…' : 'Move anyway'}
            </button>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => {
                setPendingOverride(null);
                setFailure(null);
              }}
              className={BTN}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
