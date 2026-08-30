'use client';

/**
 * "Change tour" — move a paid booking onto a different activity option and settle the difference.
 *
 * THE THREE FLOWS ARE VISIBLY DIFFERENT ON PURPOSE. The operator must know, before they commit,
 * which one they are in — the button text and the summary line both change with the sign of the
 * difference, because "propose and send a payment link" and "move this booking right now and then go
 * refund someone" are not the same action and must not share a label.
 *
 * Every figure shown here comes back from the server (`api_booking_change_quote`), which re-derives
 * it from the price list. Nothing is priced in the browser.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  quoteBookingChange,
  proposeBookingChange,
  withdrawBookingChange,
  recordChangeRefund,
  loadBookingChange,
  describeChangeError,
  type BookingChangeQuote,
  type BookingChangeRequest,
} from '@/lib/admin/booking-change';
import {
  loadQuotableActivities,
  loadActivityDepartures,
  type QuotableActivity,
  type QuoteDeparture,
} from '@/lib/admin/quote-catalogue';
import { eur, fmtDateTime } from '@/lib/admin/format';

interface Props {
  bookingId: string;
  bookingRef: string;
  /** Re-read the booking after anything commits, so the drawer's totals and items refresh. */
  onChanged: () => void;
}

/** Today in Mauritius, as the yyyy-mm-dd the date input wants. */
function todayMu(): string {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function BookingChangePanel({ bookingId, bookingRef, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [activities, setActivities] = useState<QuotableActivity[]>([]);
  const [activityId, setActivityId] = useState('');
  const [day, setDay] = useState(todayMu());
  const [departures, setDepartures] = useState<QuoteDeparture[]>([]);
  const [occurrenceId, setOccurrenceId] = useState('');
  const [quote, setQuote] = useState<BookingChangeQuote | null>(null);
  const [existing, setExisting] = useState<BookingChangeRequest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshExisting = useCallback(() => {
    void loadBookingChange(bookingId)
      .then(setExisting)
      .catch(() => setExisting(null));
  }, [bookingId]);

  useEffect(refreshExisting, [refreshExisting]);

  useEffect(() => {
    if (!open || activities.length) return;
    void loadQuotableActivities()
      .then(setActivities)
      .catch(() => setActivities([]));
  }, [open, activities.length]);

  // Departures for the chosen activity + day. Clearing the selection first matters: leaving a stale
  // occurrenceId behind would price a move against a departure no longer on screen.
  useEffect(() => {
    setOccurrenceId('');
    setQuote(null);
    if (!activityId || !day) {
      setDepartures([]);
      return;
    }
    void loadActivityDepartures(activityId, day)
      .then(setDepartures)
      .catch(() => setDepartures([]));
  }, [activityId, day]);

  // Price it the moment a departure is picked.
  useEffect(() => {
    if (!occurrenceId) return;
    setError(null);
    void quoteBookingChange(bookingId, occurrenceId)
      .then((q) => setQuote(q))
      .catch((err: unknown) => {
        setQuote(null);
        setError(describeChangeError(err));
      });
  }, [bookingId, occurrenceId]);

  async function run(label: string, fn: () => Promise<string | null>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      setNotice(msg);
      refreshExisting();
      onChanged();
    } catch (err: unknown) {
      // describeChangeError, never `err instanceof Error`: supabase-js rejects with a plain object.
      setError(describeChangeError(err));
    } finally {
      setBusy(null);
    }
  }

  const diff = quote?.differenceMinor ?? 0;
  const pendingUpgrade =
    existing && !existing.appliedAt && !existing.withdrawnAt && existing.differenceMinor > 0;
  const refundOwed = existing?.appliedAt && existing.differenceMinor < 0 && !existing.refundedAt;

  return (
    <section className="rounded-xl border border-ink/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
          Change tour
        </h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full border border-ink/15 px-3 py-1 text-[12px] font-bold hover:border-teal hover:text-teal-dark"
        >
          {open ? 'Close' : 'Move to a different tour'}
        </button>
      </div>

      {pendingUpgrade && (
        <div className="mt-3 rounded-lg bg-gold/10 px-3 py-2 text-[13px]">
          <p className="font-semibold text-ink">
            Waiting on payment of {eur(existing.differenceMinor / 100)}
          </p>
          <p className="mt-0.5 text-ink-muted">
            The seat is held{existing.expiresAt ? ` until ${fmtDateTime(existing.expiresAt)}` : ''}.
            Nothing on this booking changes until the guest pays.
          </p>
          <button
            type="button"
            disabled={busy === 'withdraw'}
            onClick={() =>
              void run('withdraw', async () => {
                await withdrawBookingChange(existing.id);
                return 'Proposal withdrawn — the held seat is back in the pool.';
              })
            }
            className="mt-2 rounded-full border border-coral/40 px-3 py-1 text-[12px] font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
          >
            {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw proposal'}
          </button>
        </div>
      )}

      {refundOwed && (
        <div className="mt-3 rounded-lg bg-coral/10 px-3 py-2 text-[13px]">
          <p className="font-semibold text-ink">
            You owe this guest {eur(-existing.differenceMinor / 100)}
          </p>
          <p className="mt-0.5 text-ink-muted">
            The booking has already moved. Refund this amount in Peach, then record it here.
          </p>
          <button
            type="button"
            disabled={busy === 'refund'}
            onClick={() => {
              const amount = eur(-existing.differenceMinor / 100);
              if (
                !window.confirm(
                  `Confirm you've refunded ${amount} to this guest in Peach. This records it in the ledger.`,
                )
              )
                return;
              void run('refund', async () => {
                const minor = await recordChangeRefund(existing.id);
                return `Recorded a refund of ${eur(minor / 100)}.`;
              });
            }}
            className="mt-2 rounded-full bg-ink px-3 py-1 text-[12px] font-bold text-white hover:bg-teal-dark disabled:opacity-50"
          >
            {busy === 'refund' ? 'Recording…' : 'Record refund'}
          </button>
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-[12px] font-semibold text-ink-muted">Tour</span>
            <select
              value={activityId}
              onChange={(e) => setActivityId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-teal"
            >
              <option value="">Choose a tour…</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                  {a.status === 'published' ? '' : ` (${a.status})`}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[12px] font-semibold text-ink-muted">Date</span>
            <input
              type="date"
              value={day}
              min={todayMu()}
              onChange={(e) => setDay(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-teal"
            />
          </label>

          {activityId && departures.length === 0 && (
            <p className="text-[13px] text-ink-muted">No departures for that tour on that date.</p>
          )}

          {departures.length > 0 && (
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-muted">Departure</span>
              <select
                value={occurrenceId}
                onChange={(e) => setOccurrenceId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-teal"
              >
                <option value="">Choose a departure…</option>
                {departures.map((d) => (
                  <option key={d.occurrenceId} value={d.occurrenceId}>
                    {d.optionName} · {fmtDateTime(d.startsAt)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {quote && (
            <div className="rounded-lg bg-ink/[0.04] px-3 py-2 text-[13px]">
              <p className="font-semibold text-ink">
                {quote.toActivityTitle} — {quote.toOptionName}
              </p>
              <dl className="mt-1 space-y-0.5 text-ink-muted">
                <div className="flex justify-between">
                  <dt>Currently</dt>
                  <dd>{eur(quote.oldTotalMinor / 100)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>New total</dt>
                  <dd>{eur(quote.newTotalMinor / 100)}</dd>
                </div>
                <div className="flex justify-between font-bold text-ink">
                  <dt>
                    {diff > 0 ? 'Guest pays' : diff < 0 ? 'You refund' : 'No change in price'}
                  </dt>
                  <dd>{diff === 0 ? '—' : eur(Math.abs(diff) / 100)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Seats left on that departure</dt>
                  <dd>{quote.capacityLeft}</dd>
                </div>
              </dl>
            </div>
          )}

          {quote && (
            <button
              type="button"
              disabled={busy === 'propose'}
              onClick={() => {
                if (diff < 0) {
                  const amount = eur(-diff / 100);
                  if (
                    !window.confirm(
                      `Move ${bookingRef} now? The booking changes immediately and you will owe the guest ${amount}, which you must refund by hand in Peach.`,
                    )
                  )
                    return;
                }
                void run('propose', async () => {
                  const r = await proposeBookingChange(bookingRef, quote.toOccurrenceId);
                  if (!r.applied)
                    return `Proposed. The seat is held and the guest owes ${eur(r.differenceMinor / 100)} — send them their booking page to pay.`;
                  if (r.refundDueMinor > 0)
                    return `Moved. You now owe the guest ${eur(r.refundDueMinor / 100)} — refund it in Peach, then record it above.`;
                  return 'Moved — same price, nothing to collect.';
                });
              }}
              className="w-full rounded-full bg-teal px-4 py-2 text-[13px] font-bold text-white hover:bg-teal-dark disabled:opacity-50"
            >
              {busy === 'propose'
                ? 'Working…'
                : diff > 0
                  ? `Propose and hold the seat — guest pays ${eur(diff / 100)}`
                  : diff < 0
                    ? `Move now — you refund ${eur(-diff / 100)}`
                    : 'Move now — same price'}
            </button>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-coral/10 px-3 py-2 text-[13px] text-coral-dark"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-2 rounded-lg bg-teal/10 px-3 py-2 text-[13px] text-teal-dark"
        >
          {notice}
        </p>
      )}
    </section>
  );
}
