'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  loadActivityOptions,
  loadAvailabilityState,
  setDailyCapacity,
  stopAvailability,
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
  const [hasOptions, setHasOptions] = useState(true);
  const [pricingMode, setPricingMode] = useState('per_person');
  const [open, setOpen] = useState(false);
  const [capacity, setCapacity] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const { capacity: cap } = await loadAvailabilityState(activityId);
    setOpen(cap != null);
    if (cap != null) setCapacity(cap);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const meta = await loadActivityOptions(activityId);
        if (!active) return;
        setTitle(meta.title);
        setHasOptions(meta.options.length > 0);
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
      ) : !hasOptions ? (
        <div className="max-w-xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-ink">
          This activity has no booking options yet. Add an option with a price in{' '}
          <Link href={`/admin/activities/${activityId}/edit`} className="font-bold text-teal hover:text-teal-dark">
            Edit
          </Link>{' '}
          first.
        </div>
      ) : (
        <div className="max-w-md rounded-2xl border border-[#EAEEF0] bg-white p-6">
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${open ? 'bg-emerald-500' : 'bg-ink/25'}`} aria-hidden />
            <h2 className="text-[15px] font-extrabold text-ink">{open ? 'Bookable every day' : 'Not bookable yet'}</h2>
          </div>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {open
              ? `Customers can book any day, up to ${capacity} ${pricingMode === 'vehicle' ? 'bookings' : 'guests'} per day.`
              : `Set how many ${pricingMode === 'vehicle' ? 'bookings' : 'guests'} can book per day, then turn it on. It stays open until you stop it.`}
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
              Bookable on every future date — a day fills up once {capacity}{' '}
              {pricingMode === 'vehicle' ? 'bookings' : 'guests'} have booked it.
            </p>
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
