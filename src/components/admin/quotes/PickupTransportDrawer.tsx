'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDialog } from '@/lib/a11y/useDialog';
import { BTN_GHOST, BTN_PRIMARY, Field, INPUT_CLS, SELECT_CLS } from '@/components/admin/ui';
import { IconPlus, IconX } from '@/components/ui/icons';
import { PickupMap } from '@/components/maps/PickupMap';
import {
  loadQuotableActivities,
  loadTransportPricing,
  type QuotableActivity,
} from '@/lib/admin/quote-catalogue';
import {
  regionFromCoords,
  transportFareMinor,
  type RegionDistanceMap,
  type TransportBandPricing,
} from '@/lib/services/pricing';
import {
  activityRegion,
  eurFromMinor,
  refusalMessage,
  transportLineDraft,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';
import type { QuotePickup } from '@/components/admin/quotes/pickup';

/** Which activities a transport add-on applies to. The region fare is for per_person / per_group
 *  tours; `vehicle` / `vehicle_custom` already price the whole drive (see 20260720000000), so they
 *  are not offered a separate transfer. */
function isTransportEligible(a: QuotableActivity): boolean {
  return a.pricingMode === 'per_person' || a.pricingMode === 'per_group';
}

/**
 * A left-hand panel to set the guest's pickup on a Google map and attach round-trip TRANSFER lines,
 * each auto-priced from that pickup by the same region-distance engine the public booking widget uses
 * (`transportFareMinor`). The suggested fare is EDITABLE afterwards on the line, so a negotiated price
 * (or an activity with no map location) is a keystroke away, never a wall.
 *
 * The panel adds a line and STAYS OPEN, unlike the tour/rental pickers: a guest with one hotel and
 * four excursions (the Christophe thread) wants four transfers set in one sitting, so the operator
 * picks the hotel once and adds each transfer without re-opening.
 */
export function PickupTransportDrawer({
  lines,
  setLines,
  pickup,
  setPickup,
  onClose,
}: {
  lines: QuoteLineDraft[];
  setLines: (lines: QuoteLineDraft[]) => void;
  pickup: QuotePickup;
  setPickup: (p: QuotePickup) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialog(true, onClose);
  const [activities, setActivities] = useState<QuotableActivity[] | null>(null);
  const [pricing, setPricing] = useState<{
    bands: TransportBandPricing;
    distances: RegionDistanceMap;
  } | null>(null);
  const [activityId, setActivityId] = useState('');
  const [paxText, setPaxText] = useState('2');
  const [suv, setSuv] = useState(false);
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    loadQuotableActivities()
      .then((rows) => setActivities(rows.filter(isTransportEligible)))
      .catch((err: unknown) => {
        setActivities([]);
        setError(refusalMessage(err, 'Could not load the tours.'));
      });
    // Fares degrade to the seed defaults on error (they are only a suggestion), so a failure here is
    // not surfaced — loadTransportPricing already falls back internally.
    loadTransportPricing()
      .then(setPricing)
      .catch(() => setPricing(null));
  }, []);

  const pickupRegion = pickup.coords
    ? regionFromCoords(pickup.coords.lat, pickup.coords.lng)
    : null;

  const activity = activities?.find((a) => a.id === activityId) ?? null;
  const actRegion = activity ? activityRegion(activity) : null;

  const pax = useMemo(() => {
    const n = Number(paxText);
    return Number.isInteger(n) && n > 0 ? n : 0;
  }, [paxText]);

  // The live suggested fare. 0 when the pickup, the activity's region or a valid party is missing —
  // transportFareMinor returns 0 for any of those, and the panel guides the operator accordingly.
  const fareMinor =
    pricing && pax > 0
      ? transportFareMinor(pickupRegion, actRegion, pax, suv, pricing.bands, pricing.distances)
      : 0;

  function addTransfer() {
    if (!activity) {
      setError('Choose which excursion the transfer is for.');
      return;
    }
    setError(null);
    const line = transportLineDraft({
      activityTitle: activity.title,
      pickupLabel: pickup.label,
      fareMinor,
      date: date || undefined,
    });
    setLines([...lines, line]);
    setAdded(
      fareMinor > 0
        ? `Added a ${eurFromMinor(fareMinor)} transfer for ${activity.title}.`
        : `Added a transfer for ${activity.title} — set its price on the line.`,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-start">
      <button
        type="button"
        aria-label="Close the pickup panel"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Set pickup and add transfers"
        className="relative flex h-[100dvh] w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl sm:rounded-r-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#EAEEF0] bg-white px-5 py-3.5">
          <span className="font-display text-lg font-semibold text-ink">
            Pickup &amp; transport
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-cream hover:text-ink"
          >
            <IconX width={18} height={18} />
          </button>
        </header>

        <div className="flex flex-col gap-5 p-5">
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-coral/10 px-4 py-3 text-[13px] font-medium text-coral"
            >
              {error}
            </p>
          )}

          {/* 1) Where we collect from */}
          <section>
            <h3 className="text-[13px] font-extrabold text-ink">Where are we collecting from?</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              Search the guest’s hotel or drag the pin. Transfer prices are worked out from how far
              it is from where each excursion boards.
            </p>
            <PickupMap
              value={pickup.label}
              onChange={(label) => setPickup({ ...pickup, label })}
              onCoords={(coords) => setPickup({ label: pickup.label, coords })}
              placeholder="Guest’s hotel or address"
            />
            {pickupRegion ? (
              <p className="mt-2 text-[12.5px] text-ink">
                Pickup region:{' '}
                <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[12px] font-bold text-teal-dark">
                  {pickupRegion}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-[12.5px] text-ink-muted">
                Pick the hotel from the suggestions or drop the pin to price transfers from it.
              </p>
            )}
          </section>

          {/* 2) Add a transfer for an excursion */}
          <section className="border-t border-[#EEF1F3] pt-4">
            <h3 className="text-[13px] font-extrabold text-ink">Add a round-trip transfer</h3>
            <div className="mt-3 flex flex-col gap-3">
              <Field label="Excursion">
                <select
                  value={activityId}
                  onChange={(e) => {
                    setActivityId(e.target.value);
                    setAdded(null);
                  }}
                  className={SELECT_CLS}
                >
                  <option value="">{activities ? 'Choose an excursion…' : 'Loading…'}</option>
                  {(activities ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                      {a.status === 'published' ? '' : ` (${a.status})`}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Travellers">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={paxText}
                    onChange={(e) => setPaxText(e.target.value)}
                    aria-label="Number of travellers for the transfer"
                    className={`${INPUT_CLS} text-right`}
                  />
                </Field>
                <Field label="Excursion day" hint="Optional — helps the run sheet.">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    aria-label="Excursion day for the transfer"
                    className={INPUT_CLS}
                  />
                </Field>
              </div>

              {pax > 0 && pax <= 4 && (
                <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={suv}
                    onChange={(e) => setSuv(e.target.checked)}
                    className="h-4 w-4 rounded border-[#CBD3D8] text-teal accent-teal focus:ring-teal"
                  />
                  SUV / 4×4 upgrade
                </label>
              )}

              {activity && actRegion === null && (
                <p className="rounded-xl bg-gold-light/20 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
                  This excursion has no map location, so we can’t work out the distance. Add the
                  transfer and type its price on the line.
                </p>
              )}

              <div className="flex items-center justify-between gap-3 rounded-xl bg-[#F7F8FA] px-4 py-3">
                <span className="text-[12.5px] text-ink-muted">
                  {!pickupRegion
                    ? 'Set the pickup point above'
                    : !activity
                      ? 'Choose an excursion'
                      : 'Suggested fare (editable on the line)'}
                </span>
                <span className="text-[16px] font-extrabold text-ink">
                  {fareMinor > 0 ? eurFromMinor(fareMinor) : '—'}
                </span>
              </div>

              <button
                type="button"
                onClick={addTransfer}
                disabled={!activity}
                className={`${BTN_PRIMARY} justify-center disabled:opacity-50`}
              >
                <IconPlus width={15} height={15} /> Add transfer to quote
              </button>

              {added && (
                <p
                  role="status"
                  className="rounded-xl bg-teal/10 px-4 py-2.5 text-[12.5px] font-medium text-teal-dark"
                >
                  {added}
                </p>
              )}
            </div>
          </section>
        </div>

        <footer className="sticky bottom-0 mt-auto flex items-center justify-end border-t border-[#EAEEF0] bg-white px-5 py-3.5">
          <button type="button" onClick={onClose} className={BTN_GHOST}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
