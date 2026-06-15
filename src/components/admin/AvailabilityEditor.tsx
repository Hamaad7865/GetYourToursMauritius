'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  addOccurrences,
  deleteOccurrence,
  loadActivityOptions,
  loadOccurrences,
  openAvailability,
  stopAvailability,
  type OccurrenceRow,
  type OptionRow,
} from '@/lib/admin/availability-write';

export function AvailabilityEditor({ activityId }: { activityId: string }) {
  const [title, setTitle] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [duration, setDuration] = useState(240);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [occurrences, setOccurrences] = useState<OccurrenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Open-availability config
  const [time, setTime] = useState('09:00');
  const [capacity, setCapacity] = useState(20);

  // Advanced one-off slot
  const [optionId, setOptionId] = useState('');
  const [date, setDate] = useState('');

  const refresh = useCallback(async () => {
    setOccurrences(await loadOccurrences(activityId));
  }, [activityId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const meta = await loadActivityOptions(activityId);
        if (!active) return;
        setTitle(meta.title);
        setOperatorId(meta.operatorId);
        setDuration(meta.durationMinutes ?? 240);
        setOptions(meta.options);
        setOptionId(meta.options[0]?.id ?? '');
        await refresh();
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load.');
      }
    })();
    return () => {
      active = false;
    };
  }, [activityId, refresh]);

  const isOpen = (occurrences?.length ?? 0) > 0;

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refresh();
      if (ok) setNotice(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const input = 'rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal';

  return (
    <div>
      <Link href="/admin/activities" className="text-sm font-bold text-teal hover:text-teal-dark">
        ← Activities
      </Link>
      <h1 className="mb-1 mt-2 font-display text-2xl font-semibold text-ink">Availability</h1>
      <p className="mb-6 text-sm text-ink-muted">{title}</p>

      {options.length === 0 ? (
        <p className="rounded-xl bg-gold-light/20 px-4 py-3 text-sm text-ink">
          This activity has no booking options yet. Add an option with a price in{' '}
          <Link href={`/admin/activities/${activityId}/edit`} className="font-bold text-teal">
            Edit
          </Link>{' '}
          first.
        </p>
      ) : (
        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${isOpen ? 'bg-teal' : 'bg-ink/25'}`}
              aria-hidden
            />
            <h2 className="font-display text-lg font-semibold text-ink">
              {isOpen ? 'Open — bookable every day' : 'Not bookable yet'}
            </h2>
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">
            {isOpen
              ? `${occurrences?.length ?? 0} upcoming slots. Bookable daily until you stop it.`
              : 'Turn this on to make the activity bookable every day, until you stop it.'}
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-ink">Daily start time</span>
              <input type="time" className={input} value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-ink">Capacity per day</span>
              <input
                type="number"
                min={1}
                className={input}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value) || 1)}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => openAvailability(activityId, { time, capacity }), 'Availability is on.')}
              className="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60"
            >
              {isOpen ? 'Update / extend' : 'Make always available'}
            </button>
            {isOpen && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => stopAvailability(activityId), 'Availability stopped.')}
                className="rounded-full border border-coral/40 px-5 py-2.5 text-sm font-bold text-coral hover:bg-coral/10 disabled:opacity-60"
              >
                Stop availability
              </button>
            )}
          </div>
        </div>
      )}

      {notice && <p className="mt-4 text-[13px] font-medium text-teal-dark">{notice}</p>}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-coral/10 px-4 py-3 text-sm font-medium text-coral">
          {error}
        </p>
      )}

      {options.length > 0 && (
        <details className="mt-5 rounded-2xl border border-ink/10 bg-white p-5">
          <summary className="cursor-pointer text-sm font-bold text-ink">Add a one-off slot</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <select className={input} value={optionId} onChange={(e) => setOptionId(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
            <input type="time" className={input} value={time} onChange={(e) => setTime(e.target.value)} />
            <button
              type="button"
              disabled={busy || !date}
              onClick={() =>
                run(
                  () =>
                    addOccurrences({
                      activityOptionId: optionId,
                      operatorId,
                      date,
                      time,
                      capacity,
                      durationMinutes: duration,
                      repeatDays: 1,
                    }),
                  'Slot added.',
                )
              }
              className="rounded-full bg-teal px-4 py-2 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60"
            >
              Add slot
            </button>
          </div>
        </details>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-ink/10 bg-white">
        {occurrences === null ? (
          <p className="p-6 text-sm text-ink-muted">Loading…</p>
        ) : occurrences.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted">No upcoming slots.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-ink/10 overflow-y-auto">
            {occurrences.slice(0, 60).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="text-ink">
                  {new Date(o.startsAt).toLocaleString('en-GB', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  <span className="text-ink-muted"> · {o.optionName} · cap {o.capacity}</span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => deleteOccurrence(o.id))}
                  className="shrink-0 rounded-lg px-3 py-1 text-[13px] font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
                >
                  Delete
                </button>
              </li>
            ))}
            {occurrences.length > 60 && (
              <li className="px-5 py-2.5 text-[13px] text-ink-muted">
                + {occurrences.length - 60} more upcoming slots…
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
