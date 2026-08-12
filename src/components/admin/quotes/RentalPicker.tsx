'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDialog } from '@/lib/a11y/useDialog';
import { BTN_GHOST, BTN_PRIMARY, Field, INPUT_CLS, SELECT_CLS } from '@/components/admin/ui';
import { IconX } from '@/components/ui/icons';
import { mauDay } from '@/lib/admin/format';
import { loadRentalFleet, type RentalVehicleInput } from '@/lib/admin/rental';
import { eurToCents, rentalDays } from '@/lib/services/pricing';
import { DatePicker } from '@/components/ui/DatePicker';
import {
  eurFromMinor,
  refusalMessage,
  rentalLineDraft,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';

/**
 * "Add rental": choose an active fleet vehicle + a pick-up and return date, priced days × daily rate.
 *
 * It mirrors the public /rent widget on purpose — same fleet, same `rentalDays`, same daily rate — so
 * the figure the operator quotes equals the one the guest was shown there. The price is the ONLY thing
 * offered: unlike a tour, there is nothing to re-price at pay time, so the line is a plain custom-shaped
 * charge that happens to name a vehicle.
 *
 * The security deposit is shown as a NOTE and never added to the line: it is a refundable hold taken at
 * handover, not part of what the guest pays for the quote. `rentalLineDraft` cannot see it, so it cannot
 * leak into the total (api_convert_quote refuses a quote whose total and lines disagree).
 */
export function RentalPicker({
  onAdd,
  onClose,
}: {
  onAdd: (lines: QuoteLineDraft[]) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialog(true, onClose);
  const [fleet, setFleet] = useState<RentalVehicleInput[] | null>(null);
  const [slug, setSlug] = useState('');
  const [pickup, setPickup] = useState(() => mauDay(new Date()));
  const [ret, setRet] = useState(() => mauDay(new Date(Date.now() + 3 * 86_400_000)));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRentalFleet()
      .then((rows) => {
        const active = rows.filter((v) => v.active);
        setFleet(active);
        setSlug((s) => s || active[0]?.slug || '');
      })
      .catch((err: unknown) => {
        setFleet([]);
        setError(refusalMessage(err, 'Could not load the rental fleet.'));
      });
  }, []);

  const vehicle = useMemo(() => fleet?.find((v) => v.slug === slug) ?? null, [fleet, slug]);

  const datesValid = Boolean(
    pickup && ret && Date.parse(`${ret}T00:00:00Z`) >= Date.parse(`${pickup}T00:00:00Z`),
  );
  const days = datesValid ? rentalDays(pickup, ret) : 0;
  const dailyRateMinor = vehicle ? eurToCents(vehicle.dailyRateEur) : 0;
  const depositMinor = vehicle ? eurToCents(vehicle.depositEur) : 0;
  const totalMinor = days * dailyRateMinor;
  const ready = Boolean(vehicle && datesValid && days > 0);

  function add() {
    if (!vehicle || !datesValid) return;
    onAdd([
      rentalLineDraft({
        slug: vehicle.slug,
        name: vehicle.name,
        dailyRateMinor: eurToCents(vehicle.dailyRateEur),
        pickupDate: pickup,
        returnDate: ret,
      }),
    ]);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close the rental picker"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add a rental to this quote"
        className="relative flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-[#EAEEF0] bg-white px-5 py-3.5">
          <span className="font-display text-lg font-semibold text-ink">Add a rental</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-cream hover:text-ink"
          >
            <IconX width={18} height={18} />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-5">
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-coral/10 px-4 py-3 text-[13px] font-medium text-coral"
            >
              {error}
            </p>
          )}

          <Field label="Vehicle">
            <select value={slug} onChange={(e) => setSlug(e.target.value)} className={SELECT_CLS}>
              <option value="">{fleet ? 'Choose a vehicle…' : 'Loading…'}</option>
              {(fleet ?? []).map((v) => (
                <option key={v.slug} value={v.slug}>
                  {v.name} — {eurFromMinor(eurToCents(v.dailyRateEur))} / day
                </option>
              ))}
            </select>
          </Field>

          {fleet && fleet.length === 0 && !error && (
            <p className="rounded-xl bg-[#F7F8FA] px-4 py-3 text-[13px] text-ink-muted">
              No active vehicles in the fleet. Add one under Rentals, or quote it as a custom line
              instead.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pick-up">
              <DatePicker
                value={pickup}
                onChange={(v) => {
                  setPickup(v);
                  if (ret && Date.parse(`${ret}T00:00:00Z`) < Date.parse(`${v}T00:00:00Z`))
                    setRet(v);
                }}
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Return">
              <DatePicker
                value={ret}
                min={pickup || undefined}
                onChange={setRet}
                className={INPUT_CLS}
              />
            </Field>
          </div>

          {vehicle && (
            <div className="rounded-xl border border-[#E2E7EA] bg-[#FCFDFD] p-3.5 text-[13px] text-ink">
              {datesValid ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-ink-muted">
                    {eurFromMinor(dailyRateMinor)} × {days} day{days === 1 ? '' : 's'}
                  </span>
                  <span className="text-[15px] font-extrabold text-ink">
                    {eurFromMinor(totalMinor)}
                  </span>
                </div>
              ) : (
                <p className="text-ink-muted">
                  Pick a return date on or after the pick-up date to see the total.
                </p>
              )}
              {depositMinor > 0 && (
                <p className="mt-2 border-t border-[#EAEEF0] pt-2 text-[12px] leading-relaxed text-ink-muted">
                  A refundable {eurFromMinor(depositMinor)} security deposit is taken at handover —
                  it is <strong>not</strong> part of this quote’s total.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-[#EAEEF0] bg-white px-5 py-3.5">
          <span className="text-[13.5px] font-bold text-ink">
            {ready ? eurFromMinor(totalMinor) : '—'}
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className={BTN_GHOST}>
              Cancel
            </button>
            <button type="button" onClick={add} disabled={!ready} className={BTN_PRIMARY}>
              Add to quote
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
