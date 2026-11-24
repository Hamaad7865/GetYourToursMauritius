'use client';

import { useCallback, useEffect, useState } from 'react';
import { DatePicker } from '@/components/ui/DatePicker';
import { closeDates, loadClosedDates, reopenDates } from '@/lib/admin/availability-write';
import {
  addDayKeys,
  formatDayRange,
  MAX_CLOSED_RANGE_DAYS,
  mauritiusDay,
  type DayRange,
} from '@/lib/admin/closed-dates';

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

const DATE_INPUT =
  'w-40 rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] px-3.5 py-2.5 text-sm text-ink outline-none focus:border-teal focus:bg-white';

/**
 * "Closed dates" — stop selling a run of days (fully booked through another channel, a private hire, a
 * holiday) without touching the tour's daily numbers. Guests already booked on those days keep their
 * booking. The rules live in closed-dates.ts / availability-write.ts.
 */
export function ClosedDatesEditor({ activityId }: { activityId: string }) {
  const today = mauritiusDay(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [ranges, setRanges] = useState<DayRange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRanges(await loadClosedDates(activityId));
  }, [activityId]);

  useEffect(() => {
    refresh().catch((err) => setError(errMessage(err, 'Could not load closed dates.')));
  }, [refresh]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const ok = await fn();
      await refresh();
      setNotice(ok);
    } catch (err) {
      setError(errMessage(err, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  const invalid = !from || !to || to < from;

  return (
    <div className="mt-6 border-t border-ink/10 pt-5">
      <h3 className="text-[13.5px] font-extrabold text-ink">Closed dates</h3>
      <p className="mt-1 text-[12px] text-ink-muted">
        Stop new bookings on specific days — e.g. fully booked elsewhere. Guests already booked on
        those days keep their booking.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-bold text-ink/60">From</span>
          <DatePicker
            value={from}
            min={today}
            allowClear={false}
            ariaLabel="Close from"
            onChange={(v) => {
              setFrom(v);
              if (to < v) setTo(v);
            }}
            className={DATE_INPUT}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-bold text-ink/60">To (included)</span>
          <DatePicker
            value={to}
            min={from || today}
            max={addDayKeys(from || today, MAX_CLOSED_RANGE_DAYS - 1)}
            allowClear={false}
            ariaLabel="Close until"
            onChange={setTo}
            className={DATE_INPUT}
          />
        </label>
        <button
          type="button"
          disabled={busy || invalid}
          onClick={() =>
            run(async () => {
              const r = await closeDates(activityId, from, to);
              return `Closed ${formatDayRange(r, today)} (${r.days} day${r.days === 1 ? '' : 's'}) to new bookings.`;
            })
          }
          className="inline-flex items-center justify-center rounded-xl border border-coral/40 px-4 py-2.5 text-[13.5px] font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
        >
          Close these dates
        </button>
      </div>

      <div className="mt-4">
        {ranges === null ? (
          <p className="text-[12px] text-ink-muted">Loading…</p>
        ) : ranges.length === 0 ? (
          <p className="text-[12px] text-ink-muted">No upcoming closed dates.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ranges.map((r) => (
              <li
                key={r.from}
                className="flex flex-wrap items-center gap-2.5 rounded-xl border border-ink/10 px-3 py-2.5"
              >
                <span className="h-2 w-2 rounded-full bg-coral" aria-hidden />
                <span className="min-w-0 flex-1 text-[13px] font-bold text-ink">
                  {formatDayRange(r, today)}
                  <span className="ml-1.5 font-medium text-ink-muted">
                    · {r.days} day{r.days === 1 ? '' : 's'}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await reopenDates(activityId, r.from, r.to);
                      return `${formatDayRange(r, today)} is bookable again.`;
                    })
                  }
                  className="rounded-lg border border-ink/15 px-3 py-1.5 text-[12.5px] font-bold text-ink hover:border-teal hover:text-teal disabled:opacity-50"
                >
                  Reopen
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 text-[11.5px] text-ink-muted">
        Changing the numbers above keeps these closed. Stop availability, or switching off a weekday
        that has a closed date, clears them.
      </p>
      {notice && <p className="mt-2 text-[13px] font-medium text-emerald-700">{notice}</p>}
      {error && (
        <p role="alert" className="mt-2 text-[13px] font-medium text-coral">
          {error}
        </p>
      )}
    </div>
  );
}
