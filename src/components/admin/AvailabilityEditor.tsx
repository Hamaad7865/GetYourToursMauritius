'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  addOccurrences,
  deleteOccurrence,
  loadActivityOptions,
  loadOccurrences,
  type OccurrenceRow,
  type OptionRow,
} from '@/lib/admin/availability-write';

export function AvailabilityEditor({ activityId }: { activityId: string }) {
  const [title, setTitle] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [duration, setDuration] = useState<number>(240);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [occurrences, setOccurrences] = useState<OccurrenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form
  const [optionId, setOptionId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [capacity, setCapacity] = useState(20);
  const [repeatDays, setRepeatDays] = useState(1);

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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!optionId) return setError('Add an option to the activity first (in Edit).');
    if (!date) return setError('Pick a date.');
    setBusy(true);
    try {
      await addOccurrences({
        activityOptionId: optionId,
        operatorId,
        date,
        time,
        capacity,
        durationMinutes: duration,
        repeatDays,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add slots.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteOccurrence(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
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
          first, then add availability here.
        </p>
      ) : (
        <form onSubmit={add} className="rounded-2xl border border-ink/10 bg-white p-5">
          <h2 className="font-display text-lg font-semibold text-ink">Add slots</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-ink">Option</span>
              <select className={input} value={optionId} onChange={(e) => setOptionId(e.target.value)}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-ink">Date</span>
              <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-ink">Time</span>
              <input type="time" className={input} value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-ink">Capacity</span>
              <input
                type="number"
                min={1}
                className={input}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value) || 1)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-bold text-ink">Repeat for (days)</span>
              <input
                type="number"
                min={1}
                max={90}
                className={input}
                value={repeatDays}
                onChange={(e) => setRepeatDays(Number(e.target.value) || 1)}
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60"
              >
                Add
              </button>
            </div>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-coral/10 px-4 py-3 text-sm font-medium text-coral">
          {error}
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-ink/10 bg-white">
        {occurrences === null ? (
          <p className="p-6 text-sm text-ink-muted">Loading…</p>
        ) : occurrences.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted">No upcoming slots. Add some above to make this bookable.</p>
        ) : (
          <ul className="divide-y divide-ink/10">
            {occurrences.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
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
                  onClick={() => remove(o.id)}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
