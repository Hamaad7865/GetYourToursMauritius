'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  clearOptionCapacity,
  loadActivityOptions,
  loadAvailabilityState,
  setDailyCapacity,
  stopAvailability,
  type OptionRow,
} from '@/lib/admin/availability-write';
import { IconChevron } from '@/components/ui/icons';
import { AdminHeading, BTN_PRIMARY } from '@/components/admin/ui';

/** Surface the real message from an Error or a Supabase/PostgREST error object (which isn't an
 *  Error instance), so failures aren't masked by a generic fallback. */
function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

export function AvailabilityEditor({ activityId }: { activityId: string }) {
  const [title, setTitle] = useState('');
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [pricingMode, setPricingMode] = useState('per_person');
  const [open, setOpen] = useState(false);
  const [capacity, setCapacity] = useState(10);
  // Per-option override inputs, keyed by option id ('' = no override → uses the activity number).
  const [optCaps, setOptCaps] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const { capacity: cap } = await loadAvailabilityState(activityId);
    setOpen(cap != null);
    if (cap != null) setCapacity(cap);
    const meta = await loadActivityOptions(activityId);
    setOptions(meta.options);
    setOptCaps(Object.fromEntries(meta.options.map((o) => [o.id, o.dailyCapacity != null ? String(o.dailyCapacity) : ''])));
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const meta = await loadActivityOptions(activityId);
        if (!active) return;
        setTitle(meta.title);
        setPricingMode(meta.pricingMode);
        await refresh();
      } catch (err) {
        if (active) setError(errMessage(err, 'Could not load.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refresh();
      setNotice(ok);
    } catch (err) {
      setError(errMessage(err, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  /** Unit copy for a capacity number: trips for a private option, vehicles for vehicle mode, else
   *  guests. With a SINGLE option there are no per-option rows, so the activity-level copy speaks
   *  for that option — a sole private option counts trips, not guests. */
  const unitNoun = (opt?: OptionRow) => {
    const o = opt ?? (options.length === 1 ? options[0] : undefined);
    return o?.isPrivate ? 'trips' : pricingMode === 'vehicle' ? 'bookings (vehicles)' : 'guests';
  };

  const hasOptionRows = options.length > 1;

  return (
    <div>
      <Link
        href="/admin/activities"
        className="mb-2 inline-flex items-center gap-1 text-[13.5px] font-semibold text-ink-muted hover:text-teal"
      >
        <IconChevron width={15} height={15} className="rotate-90" /> Back to tours
      </Link>
      <AdminHeading title="Availability" subtitle={title || 'Loading…'} />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : options.length === 0 ? (
        <div className="max-w-xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-ink">
          This activity has no booking options yet. Add an option with a price in{' '}
          <Link href={`/admin/activities/${activityId}/edit`} className="font-bold text-teal hover:text-teal-dark">
            Edit
          </Link>{' '}
          first.
        </div>
      ) : (
        <div className="max-w-xl rounded-2xl border border-[#EAEEF0] bg-white p-6">
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${open ? 'bg-emerald-500' : 'bg-ink/25'}`} aria-hidden />
            <h2 className="text-[15px] font-extrabold text-ink">{open ? 'Bookable every day' : 'Not bookable yet'}</h2>
          </div>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {open
              ? `Customers can book any day, up to ${capacity} ${unitNoun()} per day.`
              : `Set how many ${unitNoun()} can book per day, then turn it on. It stays open until you stop it.`}
          </p>

          <label className="mt-5 block">
            <span className="mb-1.5 block text-[12.5px] font-bold text-ink/60">
              {pricingMode === 'vehicle' ? 'Bookings (vehicles) per day' : 'Bookable per day (capacity)'}
            </span>
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
              className="w-40 rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] px-3.5 py-2.5 text-sm text-ink outline-none focus:border-teal focus:bg-white"
            />
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => setDailyCapacity(activityId, capacity), open ? 'Capacity updated.' : 'Now bookable every day.')}
              className={BTN_PRIMARY}
            >
              {open ? 'Update capacity' : 'Make bookable'}
            </button>
            {open && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => stopAvailability(activityId), 'Availability stopped.')}
                className="inline-flex items-center justify-center rounded-xl border border-coral/40 px-4 py-2.5 text-[13.5px] font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
              >
                Stop availability
              </button>
            )}
          </div>

          {open && (
            <p className="mt-4 text-[12px] text-ink-muted">
              Bookable on every future date — a day fills up once {capacity} {unitNoun()} have booked it.
            </p>
          )}

          {/* Per-option pools: each option can carry its OWN daily number (a private option counts
              TRIPS per day — e.g. 1 = one charter bookable per day). Blank = uses the activity number. */}
          {hasOptionRows && open && (
            <div className="mt-6 border-t border-ink/10 pt-5">
              <h3 className="text-[13.5px] font-extrabold text-ink">Per-option capacity</h3>
              <p className="mt-1 text-[12px] text-ink-muted">
                Each option can have its own daily number. Leave blank to use the activity capacity ({capacity}).
              </p>
              <div className="mt-3 flex flex-col gap-2.5">
                {options.map((o) => {
                  const val = optCaps[o.id] ?? '';
                  const overridden = o.dailyCapacity != null;
                  return (
                    <div key={o.id} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-ink/10 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-bold text-ink">
                          {o.name}
                          {o.isPrivate && (
                            <span className="ml-1.5 rounded-full bg-teal/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-teal-dark">
                              Private
                            </span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-ink-muted">
                          {overridden ? `${o.dailyCapacity} ${unitNoun(o)} per day` : `Uses activity capacity · ${unitNoun(o)}`}
                        </div>
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={val}
                        placeholder={String(capacity)}
                        aria-label={`${o.name} — ${unitNoun(o)} per day`}
                        onChange={(e) => setOptCaps((cur) => ({ ...cur, [o.id]: e.target.value }))}
                        className="w-24 rounded-lg border border-[#E2E7EA] bg-[#F7F8FA] px-2.5 py-2 text-sm text-ink outline-none focus:border-teal focus:bg-white"
                      />
                      <button
                        type="button"
                        disabled={busy || val === ''}
                        onClick={() =>
                          run(
                            () => setDailyCapacity(activityId, Math.max(0, Number(val) || 0), o.id),
                            `${o.name}: capacity updated.`,
                          )
                        }
                        className="rounded-lg bg-teal-dark px-3 py-2 text-[12.5px] font-bold text-white hover:bg-teal-dark/90 disabled:opacity-50"
                      >
                        Save
                      </button>
                      {overridden && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(() => clearOptionCapacity(activityId, o.id), `${o.name}: uses the activity capacity again.`)}
                          className="rounded-lg border border-ink/15 px-3 py-2 text-[12.5px] font-bold text-ink hover:border-teal hover:text-teal disabled:opacity-50"
                        >
                          Use default
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {notice && <p className="mt-3 text-[13px] font-medium text-emerald-700">{notice}</p>}
          {error && (
            <p role="alert" className="mt-3 text-[13px] font-medium text-coral">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
