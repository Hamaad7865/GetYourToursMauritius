'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  clearOptionCapacity,
  loadActivityOptions,
  loadAvailabilityState,
  setDailyCapacity,
  setOptionWeekdays,
  stopAvailability,
  type OptionRow,
} from '@/lib/admin/availability-write';
import {
  availableToClosedWeekdays,
  closedWeekdaysToAvailable,
  WEEKDAY_LABELS,
} from '@/lib/admin/option-weekdays';
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

const NUM_INPUT =
  'w-28 rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] px-3.5 py-2.5 text-sm text-ink outline-none focus:border-teal focus:bg-white';

/**
 * "Runs on" — seven weekday toggles (Mon…Sun) for ONE option, checked = it runs that day. Persists
 * the OFF days as the option's closed_weekdays; the save reconciles the dates already materialised
 * (see setOptionWeekdays). All-off is blocked — that's "not bookable", i.e. Stop availability.
 */
function WeekdayPicker({
  optionId,
  initialClosed,
  busy,
  onRun,
}: {
  optionId: string;
  initialClosed: number[];
  busy: boolean;
  onRun: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const storedKey = [...initialClosed].sort((a, b) => a - b).join(',');
  const [days, setDays] = useState<boolean[]>(() => closedWeekdaysToAvailable(initialClosed));
  // Re-sync from the store after a save/refresh changes the persisted value.
  useEffect(() => {
    setDays(closedWeekdaysToAvailable(initialClosed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const closed = availableToClosedWeekdays(days);
  const dirty = closed.join(',') !== storedKey;
  const noneOn = days.every((d) => !d);

  return (
    <div className="mt-3 w-full border-t border-ink/10 pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[12.5px] font-bold text-ink/60">Runs on</span>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_LABELS.map((label, i) => {
            const on = days[i];
            return (
              <button
                key={label}
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={label}
                onClick={() => setDays((cur) => cur.map((v, j) => (j === i ? !v : v)))}
                className={`grid h-9 min-w-[44px] place-items-center rounded-lg border px-2 text-[12.5px] font-bold ${
                  on
                    ? 'border-teal bg-teal/10 text-teal-dark'
                    : 'border-ink/15 bg-[#F7F8FA] text-ink/40 line-through'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={busy || !dirty || noneOn}
          onClick={() => onRun(() => setOptionWeekdays(optionId, closed), 'Running days updated.')}
          className="rounded-lg bg-teal-dark px-3 py-2 text-[12.5px] font-bold text-white hover:bg-teal-dark/90 disabled:opacity-50"
        >
          Save days
        </button>
      </div>
      <p className="mt-1.5 text-[12px] text-ink-muted">
        {noneOn
          ? 'Pick at least one day — to make it un-bookable entirely, use Stop availability.'
          : 'Days switched off never become bookable; a booking already on one is kept, you reschedule it.'}
      </p>
    </div>
  );
}

/**
 * Availability = TWO numbers everywhere, matching how the owner actually plans a day:
 *   * Trips per day  — how many departures can run;
 *   * Guests per trip — how many guests ONE trip (one booking) can take.
 *
 * Storage keeps `daily_capacity` as the POOL in its historic units, so the whole capacity machinery
 * (holds, reschedule, sweeps) is untouched:
 *   * shared options: pool = trips × guests (written on save), one booking capped at guests/trip
 *     (activities/activity_options.guests_per_trip; create_booking enforces it);
 *   * private options: pool = trips (unchanged), guests/trip IS private_max_guests;
 *   * vehicle mode: pool = bookings (vehicles), guests fixed by the vehicle brackets (≤25) — the
 *     one mode that keeps a single input.
 *
 * A legacy shared activity (no guests_per_trip yet) loads as 1 trip × pool guests — behaviourally
 * identical to what it had (the pool already capped any one booking), just now stated in two
 * numbers the owner can edit.
 */
export function AvailabilityEditor({ activityId }: { activityId: string }) {
  const [title, setTitle] = useState('');
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [pricingMode, setPricingMode] = useState('per_person');
  const [open, setOpen] = useState(false);
  const [trips, setTrips] = useState(1);
  const [guests, setGuests] = useState(10);
  // Per-option override inputs, keyed by option id ('' = no override → uses the activity numbers).
  const [optTrips, setOptTrips] = useState<Record<string, string>>({});
  const [optGuests, setOptGuests] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const isVehicle = pricingMode === 'vehicle';
  // The sole option of a single-option activity decides the MAIN form's shape (the common case —
  // e.g. "Private Cataspeed 5 Islands" is one private option).
  const soleOption = options.length === 1 ? options[0] : undefined;
  const soleIsPrivate = Boolean(soleOption?.isPrivate);
  // Shared two-number mode: pool = trips × guests. Vehicle and sole-private keep pool = trips.
  const mainIsShared = !isVehicle && !soleIsPrivate;
  const pool = mainIsShared ? trips * guests : trips;

  async function refresh() {
    const { capacity: cap, guestsPerTrip: gpt } = await loadAvailabilityState(activityId);
    const meta = await loadActivityOptions(activityId);
    setOpen(cap != null);
    const sole = meta.options.length === 1 ? meta.options[0] : undefined;
    const vehicle = (meta.pricingMode ?? 'per_person') === 'vehicle';
    if (cap != null) {
      if (vehicle || sole?.isPrivate) {
        // Pool counts trips/vehicles directly — one number.
        setTrips(cap);
      } else if (gpt && gpt > 0) {
        // Factor the stored pool back into trips × guests (the pool is written as the product, so
        // this divides; round defensively for hand-patched rows).
        setGuests(gpt);
        setTrips(Math.max(1, Math.round(cap / gpt)));
      } else {
        // Legacy: no guests/trip yet → read the pool truthfully as ONE trip that takes it all.
        setGuests(Math.max(1, cap));
        setTrips(1);
      }
    }
    // A sole private option's guests/trip is its max group size (pricing config, shown here too).
    if (sole?.isPrivate && sole.privateMaxGuests != null) setGuests(sole.privateMaxGuests);
    setOptions(meta.options);
    setOptTrips(
      Object.fromEntries(
        meta.options.map((o) => {
          if (o.dailyCapacity == null) return [o.id, ''];
          if (o.isPrivate) return [o.id, String(o.dailyCapacity)];
          const g = o.guestsPerTrip ?? gpt;
          return [
            o.id,
            String(g && g > 0 ? Math.max(1, Math.round(o.dailyCapacity / g)) : o.dailyCapacity),
          ];
        }),
      ),
    );
    setOptGuests(
      Object.fromEntries(
        meta.options.map((o) => {
          if (o.isPrivate)
            return [o.id, o.privateMaxGuests != null ? String(o.privateMaxGuests) : ''];
          return [o.id, o.guestsPerTrip != null ? String(o.guestsPerTrip) : ''];
        }),
      ),
    );
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

  /** Persist the MAIN form: the pool (+ guests/trip where it applies) at the activity level; a sole
   *  private option's guests number goes to its own row (private_max_guests) in the same run. */
  async function saveMain() {
    if (soleOption?.isPrivate) {
      const floor = soleOption.privateIncluded ?? 1;
      // Throw (not setError) so run() reports the failure instead of a false success notice.
      if (guests < floor) {
        throw new Error(
          `Guests per trip can’t be below ${floor} — the base price covers ${floor}.`,
        );
      }
      await setDailyCapacity(activityId, trips);
      await setDailyCapacity(activityId, null, {
        optionId: soleOption.id,
        guestsPerTrip: guests,
      });
      return;
    }
    if (isVehicle) {
      await setDailyCapacity(activityId, trips);
      return;
    }
    await setDailyCapacity(activityId, trips * guests, { guestsPerTrip: guests });
  }

  /** Unit copy for the POOL: trips for a private option, vehicles for vehicle mode, else guests.
   *  With a SINGLE option there are no per-option rows, so the activity-level copy speaks for that
   *  option — a sole private option counts trips, not guests. */
  const unitNoun = (opt?: OptionRow) => {
    const o = opt ?? soleOption;
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
          <Link
            href={`/admin/activities/${activityId}/edit`}
            className="font-bold text-teal hover:text-teal-dark"
          >
            Edit
          </Link>{' '}
          first.
        </div>
      ) : (
        <div className="max-w-xl rounded-2xl border border-[#EAEEF0] bg-white p-6">
          <div className="flex items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${open ? 'bg-emerald-500' : 'bg-ink/25'}`}
              aria-hidden
            />
            <h2 className="text-[15px] font-extrabold text-ink">
              {open ? 'Bookable every day' : 'Not bookable yet'}
            </h2>
          </div>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {open
              ? `Customers can book any day, up to ${pool} ${unitNoun()} per day.`
              : `Set the day's numbers, then turn it on. It stays open until you stop it.`}
          </p>

          <div className="mt-5 flex flex-wrap gap-4">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-bold text-ink/60">
                {isVehicle ? 'Bookings (vehicles) per day' : 'Trips per day'}
              </span>
              <input
                type="number"
                min={1}
                value={trips}
                onChange={(e) => setTrips(Math.max(1, Number(e.target.value) || 1))}
                className={NUM_INPUT}
              />
            </label>
            {!isVehicle && (
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] font-bold text-ink/60">
                  Guests per trip
                </span>
                <input
                  type="number"
                  min={soleIsPrivate ? (soleOption?.privateIncluded ?? 1) : 1}
                  value={guests}
                  onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))}
                  className={NUM_INPUT}
                />
              </label>
            )}
          </div>
          <p className="mt-2 text-[12px] text-ink-muted">
            {isVehicle
              ? 'Each booking is one vehicle; guests per vehicle follow the vehicle brackets (up to 25).'
              : soleIsPrivate
                ? `${trips} ${trips === 1 ? 'trip' : 'trips'} bookable per day; one charter takes up to ${guests} guests${
                    soleOption?.privateIncluded != null
                      ? ` (base price covers ${soleOption.privateIncluded})`
                      : ''
                  }.`
                : `= ${trips * guests} guests bookable per day; one booking takes up to ${guests}.`}
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(saveMain, open ? 'Availability updated.' : 'Now bookable every day.')
              }
              className={BTN_PRIMARY}
            >
              {open ? 'Update availability' : 'Make bookable'}
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
              Bookable on every future date — a day fills up once {pool} {unitNoun()} have booked
              it.
            </p>
          )}

          {/* Sole-option tours (e.g. the sunset catamaran) set their weekdays here; multi-option
              tours set them per option in the rows below. */}
          {open && soleOption && (
            <WeekdayPicker
              optionId={soleOption.id}
              initialClosed={soleOption.closedWeekdays}
              busy={busy}
              onRun={run}
            />
          )}

          {/* Per-option pools: each option can carry its OWN two numbers. A private option counts
              TRIPS per day (e.g. 1 = one charter/day) and its guests number IS its max group size;
              a shared option's pool is trips × guests. Blank trips = uses the activity numbers. */}
          {hasOptionRows && open && (
            <div className="mt-6 border-t border-ink/10 pt-5">
              <h3 className="text-[13.5px] font-extrabold text-ink">Per-option availability</h3>
              <p className="mt-1 text-[12px] text-ink-muted">
                Each option can have its own numbers. Leave trips blank to use the activity’s (
                {pool} {unitNoun()} per day).
              </p>
              <div className="mt-3 flex flex-col gap-2.5">
                {options.map((o) => {
                  const tVal = optTrips[o.id] ?? '';
                  const gVal = optGuests[o.id] ?? '';
                  const overridden = o.dailyCapacity != null || o.guestsPerTrip != null;
                  const tNum = Number(tVal);
                  const gNum = Number(gVal);
                  // A shared save needs both numbers (the pool is their product); a private save
                  // accepts trips alone (guests always has its private_max_guests value).
                  const savable = o.isPrivate
                    ? tVal !== '' || gVal !== ''
                    : tVal !== '' && gVal !== '';
                  return (
                    <div
                      key={o.id}
                      className="flex flex-wrap items-center gap-2.5 rounded-xl border border-ink/10 px-3 py-2.5"
                    >
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
                          {o.isPrivate
                            ? `${o.dailyCapacity != null ? `${o.dailyCapacity} trips/day` : 'Trips: activity number'} · up to ${o.privateMaxGuests ?? '—'} guests per trip`
                            : overridden && o.dailyCapacity != null
                              ? `${o.dailyCapacity} guests per day · up to ${o.guestsPerTrip ?? 'any'} per booking`
                              : `Uses activity numbers · ${unitNoun(o)}`}
                        </div>
                      </div>
                      <label className="flex items-center gap-1.5 text-[11.5px] font-bold text-ink/60">
                        Trips
                        <input
                          type="number"
                          min={0}
                          value={tVal}
                          placeholder={String(mainIsShared ? trips : pool)}
                          aria-label={`${o.name} — trips per day`}
                          onChange={(e) =>
                            setOptTrips((cur) => ({ ...cur, [o.id]: e.target.value }))
                          }
                          className="w-20 rounded-lg border border-[#E2E7EA] bg-[#F7F8FA] px-2.5 py-2 text-sm text-ink outline-none focus:border-teal focus:bg-white"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-[11.5px] font-bold text-ink/60">
                        Guests
                        <input
                          type="number"
                          min={o.isPrivate ? (o.privateIncluded ?? 1) : 1}
                          value={gVal}
                          placeholder={o.isPrivate ? '' : String(guests)}
                          aria-label={`${o.name} — guests per trip`}
                          onChange={(e) =>
                            setOptGuests((cur) => ({ ...cur, [o.id]: e.target.value }))
                          }
                          className="w-20 rounded-lg border border-[#E2E7EA] bg-[#F7F8FA] px-2.5 py-2 text-sm text-ink outline-none focus:border-teal focus:bg-white"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy || !savable}
                        onClick={() => {
                          if (o.isPrivate) {
                            const floor = o.privateIncluded ?? 1;
                            if (gVal !== '' && gNum < floor) {
                              setError(
                                `${o.name}: guests per trip can’t be below ${floor} — the base price covers ${floor}.`,
                              );
                              return;
                            }
                            void run(
                              () =>
                                setDailyCapacity(
                                  activityId,
                                  tVal !== '' ? Math.max(0, tNum || 0) : null,
                                  {
                                    optionId: o.id,
                                    ...(gVal !== ''
                                      ? { guestsPerTrip: Math.max(1, gNum || 1) }
                                      : {}),
                                  },
                                ),
                              `${o.name}: availability updated.`,
                            );
                            return;
                          }
                          void run(
                            () =>
                              setDailyCapacity(
                                activityId,
                                Math.max(0, tNum || 0) * Math.max(1, gNum || 1),
                                { optionId: o.id, guestsPerTrip: Math.max(1, gNum || 1) },
                              ),
                            `${o.name}: availability updated.`,
                          );
                        }}
                        className="rounded-lg bg-teal-dark px-3 py-2 text-[12.5px] font-bold text-white hover:bg-teal-dark/90 disabled:opacity-50"
                      >
                        Save
                      </button>
                      {overridden && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => clearOptionCapacity(activityId, o.id),
                              `${o.name}: uses the activity numbers again.`,
                            )
                          }
                          className="rounded-lg border border-ink/15 px-3 py-2 text-[12.5px] font-bold text-ink hover:border-teal hover:text-teal disabled:opacity-50"
                        >
                          Use default
                        </button>
                      )}
                      <WeekdayPicker
                        optionId={o.id}
                        initialClosed={o.closedWeekdays}
                        busy={busy}
                        onRun={run}
                      />
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
