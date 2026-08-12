'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { monthCells } from '@/lib/calendar/month';
import { nominalDayKey } from '@/lib/services/day-key';
import { useDialog } from '@/lib/a11y/useDialog';
import { eur, fmtDateShort, fmtDateTime, fmtTime } from '@/lib/admin/format';
import { IconChevron } from '@/components/ui/icons';
import { AdminHeading, AdminError, BTN_GHOST, SELECT_CLS } from './ui';
import { PickupFacts, Pill, TransferFacts, paymentPill, statusPill } from './BookingFacts';
import {
  CALL_OFF_REASONS,
  callOffDeparture,
  loadCalendarMonth,
  loadCustomLinesByDay,
  loadDaySchedule,
  customLineLabel,
  loadMoveTargets,
  notifiableCount,
  rescheduleBookingAsStaff,
  type CalendarDay,
  type CallOffReason,
  type DayBooking,
  type DayCustomLine,
  type DayDeparture,
  type DayEntry,
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

/** "2 × Adult · 1 × Child" — the bands actually sold, so the guide knows who they are meeting. */
function bandSummary(booking: DayBooking): string {
  return booking.lines.map((l) => `${l.quantity} × ${l.label}`).join(' · ');
}

/** How many quote-line names one month cell prints before collapsing the rest into "+N more". */
const MAX_CELL_LABELS = 2;

/**
 * What the grid needs to render one day. The month RPC aggregate (`info`) is absent for a day whose
 * ONLY booking is a converted quote — those are pure `booking_custom_items`, which the RPC never
 * counts — so `info` is nullable and `customLines`, read from the separate month-wide custom-line
 * read, is what keeps such a day clickable AND what the cell names.
 */
interface DayModel {
  info: CalendarDay | null;
  customLines: DayCustomLine[];
}

/**
 * Month grid for the operations calendar.
 *
 * Built on the shared `monthCells()` rather than reusing the customer MonthGrid: that one disables
 * unavailable cells, pins a `tomorrow` lower bound (an operator looks backwards), and renders only a
 * number with no room for a load summary. Sharing the maths and writing our own cells is the pattern
 * TripDatePicker already follows.
 *
 * Availability is materialised for every activity every day, so raw departure counts are noise — a
 * day always has ~45. The grid instead surfaces the days that carry GUESTS: a day with bookings, a
 * called-off departure, or a custom/rental line from a converted quote is a solid, clickable cell; an
 * empty day is a quiet, non-interactive number. That way the operator's eye lands straight on the days
 * that need attention.
 */
function AdminMonthGrid({
  month,
  byDay,
  selected,
  onPick,
}: {
  month: Date;
  byDay: Map<string, DayModel>;
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
          const model = byDay.get(key);
          const isToday = key === todayKey;
          const isSelected = key === selected;
          const calledOff = (model?.info?.cancelled ?? 0) > 0;
          const pax = model?.info?.pax ?? 0;
          const booked = pax > 0;
          // A converted-quote-only day has pax 0 and no called-off departure, but still holds a
          // dated line the drawer can show — so it must be clickable like a called-off day is.
          const customLines = model?.customLines ?? [];
          const hasCustomLines = customLines.length > 0;
          const active = booked || calledOff || hasCustomLines;
          // Two names at most: the cell is 64px tall and already carries the date and any headcount.
          // De-duplicated because a day can hold the same label twice (an activity and its transfer
          // both reduce to their own head, but two guests on one tour would repeat).
          const customLabels = [...new Set(customLines.map((l) => customLineLabel(l.description)))];
          const extraCustom = Math.max(0, customLabels.length - MAX_CELL_LABELS);
          customLabels.length = Math.min(customLabels.length, MAX_CELL_LABELS);
          const dateEl = (
            <span
              className={`text-[12.5px] font-bold ${
                isToday ? 'text-teal' : active ? 'text-ink' : 'text-ink-muted'
              }`}
            >
              {cell.getDate()}
            </span>
          );

          // Quiet, non-interactive cell only for a day with nothing on it at all.
          if (!active) {
            return (
              <div
                key={key}
                className="min-h-[64px] rounded-xl border border-transparent p-1.5 text-left"
              >
                {dateEl}
              </div>
            );
          }

          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              aria-pressed={isSelected}
              aria-label={`${dayLabel(key)} — ${pax} guest${pax === 1 ? '' : 's'} booked${
                calledOff ? ', has a called-off departure' : ''
              }${hasCustomLines ? ', has a custom or rental line' : ''}`}
              className={`min-h-[64px] rounded-xl border p-1.5 text-left transition ${
                isSelected
                  ? 'border-teal bg-teal/10'
                  : calledOff
                    ? 'border-coral/40 bg-coral/[0.06] hover:border-coral/60'
                    : 'border-teal/30 bg-teal/[0.04] hover:border-teal/50 hover:bg-teal/[0.08]'
              }`}
            >
              {dateEl}
              <span className="mt-0.5 block text-[10.5px] leading-tight text-ink-muted">
                {pax > 0 && (
                  <span className="font-bold text-ink/80">
                    {pax} guest{pax === 1 ? '' : 's'}
                  </span>
                )}
                {calledOff && <span className="block font-bold text-coral">called off</span>}
                {/* NAME the quote lines rather than tagging them "custom line". Scanning a month for
                    "what is on the 1st" used to mean opening every lit day in turn; the descriptions
                    are already loaded, so the cell can just say. Shown even on a day that also has
                    guests — a transfer sitting under a booked departure is exactly what gets missed. */}
                {customLabels.map((label) => (
                  <span key={label} className="block truncate font-bold text-ink/80" title={label}>
                    {label}
                  </span>
                ))}
                {extraCustom > 0 && (
                  <span className="block text-ink-muted">+{extraCustom} more</span>
                )}
              </span>
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
  const [byDay, setByDay] = useState<Map<string, DayModel>>(new Map());
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
    // Two reads for the one grid: the RPC headcount aggregate, and the days that carry a custom/rental
    // line the RPC can't see. The custom-line read degrades to "no extra days" on failure rather than
    // blanking the whole calendar — losing it just brings back the old dead-cell behaviour, whereas a
    // failed month RPC is a genuine "couldn't load" the operator must know about.
    Promise.all([
      loadCalendarMonth(from, to),
      loadCustomLinesByDay(from, to).catch(() => new Map<string, DayCustomLine[]>()),
    ])
      .then(([rows, customByDay]) => {
        if (!active) return;
        const map = new Map<string, DayModel>();
        for (const r of rows)
          map.set(r.day, { info: r, customLines: customByDay.get(r.day) ?? [] });
        // A day with ONLY custom lines has no RPC row, so seed it here or it stays un-clickable.
        for (const [day, lines] of customByDay) {
          if (!map.has(day)) map.set(day, { info: null, customLines: lines });
        }
        setByDay(map);
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
        subtitle="Every departure, day by day. Open a day for the full picture on each guest — pickup, child seats, flights, notes — then move them or call the departure off."
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
  const [entries, setEntries] = useState<DayEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    loadDaySchedule(day)
      .then((rows) => active && setEntries(rows))
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Could not load this day.');
        setEntries([]);
      });
    return () => {
      active = false;
    };
  }, [day, reloadKey]);

  const reload = useCallback(() => {
    setEntries(null);
    setReloadKey((k) => k + 1);
    onChanged();
  }, [onChanged]);

  // Split the union so the seat-count summary reads only the real departures — a custom/rental line
  // holds no seat. `pax`/`pendingPax` exist only on occurrence entries, so this narrowing is required.
  const departures = entries?.filter((e): e is DayDeparture => e.kind === 'occurrence') ?? [];
  const customLines = entries?.filter((e): e is DayCustomLine => e.kind === 'custom') ?? [];
  const guests = departures.reduce((s, d) => s + d.pax, 0);
  const pendingPax = departures.reduce((s, d) => s + d.pendingPax, 0);

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
            {entries && entries.length > 0 && (
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                {departures.length} booked departure{departures.length === 1 ? '' : 's'} · {guests}{' '}
                guests
                {pendingPax > 0 && (
                  <span className="text-amber-700"> · {pendingPax} awaiting payment</span>
                )}
                {customLines.length > 0 && (
                  <span>
                    {' '}
                    · {customLines.length} other line{customLines.length === 1 ? '' : 's'}
                  </span>
                )}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Close
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          {error && <AdminError>{error}</AdminError>}
          {entries === null && <p className="text-sm text-ink-muted">Loading…</p>}
          {entries?.length === 0 && !error && (
            <p className="py-10 text-center text-sm text-ink-muted">No bookings on this day.</p>
          )}
          {entries?.map((entry) =>
            entry.kind === 'occurrence' ? (
              <DepartureCard
                key={`occ-${entry.occurrenceId}`}
                departure={entry}
                onChanged={reload}
              />
            ) : (
              <CustomLineCard key={`ci-${entry.id}`} line={entry} />
            ),
          )}
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
  const calledOff = departure.status === 'cancelled';
  // Not departure.bookings.length: the fan-out inside api_weather_cancel_occurrence skips completed,
  // unpaid and already-disrupted parties, and this card now lists unpaid ones too. Promising mail to
  // a guest who will never receive it is exactly the sort of thing staff act on and later regret.
  const willEmail = notifiableCount(departure);

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
            {departure.optionName} · {fmtTime(departure.startsAt)} · {departure.pax} of{' '}
            {departure.capacity}
            {departure.pendingPax > 0 && (
              <span className="text-amber-700"> · +{departure.pendingPax} unpaid</span>
            )}
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
            <li key={b.id}>
              <GuestRow
                booking={b}
                departure={departure}
                calledOff={calledOff}
                onChanged={onChanged}
              />
            </li>
          ))}
        </ul>
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
            {willEmail > 0 ? (
              <>
                This emails{' '}
                <strong>
                  {willEmail} paid guest{willEmail === 1 ? '' : 's'}
                </strong>{' '}
                straight away asking them to pick a new date or take a refund, and closes the date
                to new bookings.
              </>
            ) : (
              <>
                This closes the date to new bookings. <strong>Nobody is emailed</strong> — no paid
                guest on this departure is waiting on an answer.
              </>
            )}{' '}
            <strong>It cannot be undone from here.</strong>
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

/**
 * A dated custom or car-rental line from a converted quote. It lives on no departure, so it shows
 * none of the departure furniture: no capacity, no headcount, and no "call off" control — there is
 * no occurrence to call off, and a rental's quantity is VEHICLES, not people. It carries what staff
 * need to run it: what was sold, when (and, for a multi-day rental, until when), who booked it, how
 * to reach them, and a jump to the full booking.
 */
function CustomLineCard({ line }: { line: DayCustomLine }) {
  const isRental = line.lineKind === 'rental';
  const unit = isRental ? 'vehicle' : 'item';
  return (
    <div
      className={`rounded-2xl border p-4 ${
        line.counted ? 'border-[#EAEEF0] bg-white' : 'border-amber-200 bg-amber-50/40'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{line.description}</p>
          <p className="text-[12.5px] text-ink-muted">
            {fmtTime(line.startsAt)}
            {isRental && line.endsAt && <> · until {fmtDateShort(line.endsAt)}</>}
            {/* The bespoke-tour headcount — the run-sheet fact the card never showed. A rental's
                `quantity` is vehicles, so guests is null there and only the vehicle count shows. */}
            {line.guests != null && (
              <>
                {' '}
                · {line.guests} guest{line.guests === 1 ? '' : 's'}
              </>
            )}
            {line.quantity > 1 && (
              <>
                {' '}
                · {line.quantity} {unit}s
              </>
            )}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-ink/[0.06] px-2.5 py-1 text-[11px] font-bold text-ink/70">
          {isRental ? 'Rental' : 'Custom line'}
        </span>
      </div>

      {/* The run sheet: where to collect this tour from (its own pickup hotel, or the round-trip
          transfer it carries) and the guest's room for the driver's gate pass. Rentals collect at the
          depot, so they show none of this. */}
      {!isRental && (line.pickupLabel || line.transportPickup || line.roomOrCabin) && (
        <div className="mt-3 border-t border-[#F2F4F6] pt-3">
          <PickupFacts
            pickupLocation={line.pickupLabel}
            dropoffLocation={null}
            pickupPending={false}
            transportPickup={line.transportPickup}
            transportDropoff={line.transportDropoff}
            roomOrCabin={line.roomOrCabin}
          />
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2 border-t border-[#F2F4F6] pt-3 text-[12.5px]">
        <p className="text-ink">
          <span className="font-bold">{line.ref}</span> · {line.customerName || 'Guest'}
        </p>
        {(!line.counted || line.staffNote) && (
          <span className="flex flex-wrap gap-1">
            {!line.counted && <Chip tone="amber">Awaiting payment</Chip>}
            {line.staffNote && <Chip tone="ink">Note</Chip>}
          </span>
        )}
        <div className="flex flex-col gap-0.5">
          <a
            href={`mailto:${line.customerEmail}`}
            className="block truncate text-teal underline underline-offset-2"
          >
            {line.customerEmail}
          </a>
          {line.customerPhone && (
            <a
              href={`tel:${line.customerPhone.replace(/\s+/g, '')}`}
              className="font-medium text-teal underline underline-offset-2"
            >
              {line.customerPhone}
            </a>
          )}
        </div>
        {line.staffNote && <p className="whitespace-pre-wrap text-ink/80">{line.staffNote}</p>}
        <p className="text-ink/80">
          {eur(line.subtotalEur)} · booked {fmtDateTime(line.bookedAt)} · via {line.source}
        </p>
        <Link
          href={`/admin/bookings?open=${line.bookingId}`}
          className="font-bold text-teal underline underline-offset-2"
        >
          Open full booking →
        </Link>
      </div>
    </div>
  );
}

/** A small labelled block inside the expanded guest panel. */
function Fact({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[#F2F4F6] pt-2.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * One party on a departure: a scannable line that expands to everything staff need to run the trip.
 *
 * Collapsed it answers "who, how many, anything unusual?"; expanded it answers the rest — contact
 * details, the bands sold, where to collect them, the child seats to fit, flight numbers, the route
 * they chose and the note somebody left. The chips exist so the unusual cases (unpaid, child seats,
 * pickup still to arrange, owed a new date) are visible WITHOUT expanding every row in turn.
 */
function GuestRow({
  booking,
  departure,
  calledOff,
  onChanged,
}: {
  booking: DayBooking;
  departure: DayDeparture;
  calledOff: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const panelId = `guest-${booking.id}`;

  return (
    <div
      className={`rounded-xl border ${
        booking.counted ? 'border-[#F2F4F6]' : 'border-amber-200 bg-amber-50/40'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start gap-2 p-2.5 text-left"
      >
        <IconChevron
          width={14}
          height={14}
          aria-hidden="true"
          className={`mt-1 shrink-0 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] text-ink">
            <span className="font-bold">{booking.ref}</span> · {booking.customerName || 'Guest'} ·{' '}
            {booking.pax} pax
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
            {bandSummary(booking)}
          </span>
          <span className="mt-1 flex flex-wrap gap-1">
            {!booking.counted && (
              <Chip tone="amber">
                {booking.status === 'held' ? 'Seat held' : 'Awaiting payment'}
              </Chip>
            )}
            {booking.childSeats > 0 && (
              <Chip tone="teal">
                {booking.childSeats} child seat{booking.childSeats === 1 ? '' : 's'}
              </Chip>
            )}
            {booking.supplements.map((s) => (
              <Chip key={s.name} tone="teal">
                {s.qty} × {s.name}
              </Chip>
            ))}
            {booking.pickupPending && !booking.pickupLocation && (
              <Chip tone="amber">Pickup TBD</Chip>
            )}
            {booking.transfer && <Chip tone="ink">Airport transfer</Chip>}
            {booking.awaitingChoice && <Chip tone="coral">Owes us an answer</Chip>}
            {booking.staffNote && <Chip tone="ink">Note</Chip>}
          </span>
        </span>
      </button>

      {open && (
        <div id={panelId} className="flex flex-col gap-2.5 px-2.5 pb-3 text-[12.5px]">
          <Fact title="Contact">
            <a
              href={`mailto:${booking.customerEmail}`}
              className="block truncate text-teal underline underline-offset-2"
            >
              {booking.customerEmail}
            </a>
            {booking.customerPhone && (
              <a
                href={`tel:${booking.customerPhone.replace(/\s+/g, '')}`}
                className="block font-medium text-teal underline underline-offset-2"
              >
                {booking.customerPhone}
              </a>
            )}
          </Fact>

          <Fact title="Party">
            <ul className="flex flex-col gap-0.5 text-ink/80">
              {booking.lines.map((l) => (
                <li key={l.label}>
                  {l.quantity} × {l.label}
                  {l.pax !== l.quantity && ` · ${l.pax} pax`}
                </li>
              ))}
            </ul>
          </Fact>

          <Fact title="Pickup &amp; drop-off">
            {/* PickupFacts folds the round-trip transfer INTO the reading: a booking whose only hotel is
                on the line's transfer now reads "<hotel> · Round-trip transfer" + "Same as pickup",
                never "No pickup · customer makes own way" beside a separate transfer line. */}
            <PickupFacts
              pickupLocation={booking.pickupLocation}
              dropoffLocation={booking.dropoffLocation}
              pickupPending={booking.pickupPending}
              transportPickup={booking.transportPickup}
              transportDropoff={booking.transportDropoff}
              roomOrCabin={booking.roomOrCabin}
            />
          </Fact>

          {booking.childSeats > 0 && (
            <Fact title="Baby &amp; child seats">
              <p className="text-ink/80">
                {booking.childSeats} seat{booking.childSeats === 1 ? '' : 's'} to fit
                {booking.transfer?.childSeatAge != null &&
                  ` · child aged ${booking.transfer.childSeatAge}`}
              </p>
            </Fact>
          )}

          {booking.transfer && (
            <Fact title="Transfer details">
              <TransferFacts transfer={booking.transfer} />
            </Fact>
          )}

          {booking.customItinerary && booking.customItinerary.length > 0 && (
            <Fact title="Customer route">
              <ol className="list-decimal pl-5 text-ink/80">
                {booking.customItinerary.map((s, i) => (
                  <li key={i}>{s.area ? `${s.title} — ${s.area}` : s.title}</li>
                ))}
              </ol>
            </Fact>
          )}

          {booking.staffNote && (
            <Fact title="Internal note">
              <p className="whitespace-pre-wrap text-ink/80">{booking.staffNote}</p>
            </Fact>
          )}

          <Fact title="Booking">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill p={statusPill(booking.status)} />
              <Pill p={paymentPill(booking.paymentState, booking.status)} />
            </div>
            <p className="mt-1.5 text-ink/80">
              {eur(booking.totalEur)} · booked {fmtDateTime(booking.bookedAt)} · via{' '}
              {booking.source}
            </p>
          </Fact>

          <div className="flex flex-wrap items-center gap-3 border-t border-[#F2F4F6] pt-2.5">
            {/* Rescheduling needs a confirmed, paid booking — api_reschedule_booking rejects anything
                else, so offering the button on an unpaid party would only ever produce an error. */}
            {!calledOff && booking.reschedulable && (
              <button
                type="button"
                onClick={() => setMoving((v) => !v)}
                className="font-bold text-teal underline underline-offset-2"
              >
                {moving ? 'Cancel move' : 'Move to another date'}
              </button>
            )}
            <Link
              href={`/admin/bookings?open=${booking.id}`}
              className="font-bold text-teal underline underline-offset-2"
            >
              Open full booking →
            </Link>
          </div>

          {moving && (
            <MovePicker
              bookingRef={booking.ref}
              activityOptionId={departure.activityOptionId}
              excludeOccurrenceId={departure.occurrenceId}
              onDone={() => {
                setMoving(false);
                onChanged();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

const CHIP_TONES = {
  amber: 'bg-amber-100 text-amber-800',
  teal: 'bg-teal/10 text-teal-dark',
  coral: 'bg-coral/15 text-coral',
  ink: 'bg-ink/[0.06] text-ink/70',
} as const;

function Chip({ tone, children }: { tone: keyof typeof CHIP_TONES; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${CHIP_TONES[tone]}`}>
      {children}
    </span>
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
