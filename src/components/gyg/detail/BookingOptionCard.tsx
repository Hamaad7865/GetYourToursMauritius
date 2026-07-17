'use client';

import { useEffect, useRef } from 'react';
import { useBooking } from './BookingProvider';
import { OptionSelector } from './OptionSelector';
import { useCart } from '@/lib/cart/useCart';
import { useToast } from '@/components/site/ToastProvider';
import { useT, useMoney } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { SIGHTSEEING_SUV_MAX, CHILD_SEAT_EUR } from '@/lib/services/pricing';
import { durationLabel } from '@/lib/catalogue/detail';
import type { AltStop } from '@/lib/validation/tours';
import {
  IconCheck,
  IconClock,
  IconGlobe,
  IconMinus,
  IconPin,
  IconPlus,
  IconUsers,
} from '@/components/ui/icons';

/** GetYourGuide "option available" card. Revealed after Check availability; shows the selection
 *  summary, the price, the Sedan/SUV choice (vehicle, ≤4 pax), and Continue / Add to cart. */
export function BookingOptionCard() {
  const t = useT();
  const money = useMoney();
  const b = useBooking();
  const { add: addToCart } = useCart();
  const { showToast } = useToast();
  // Pressing "Check availability" from anywhere on the page should bring the card into view. The
  // scrollTick bumps on every press, so a repeat press re-centres the card even when it's already open.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (b.checked) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [b.checked, b.scrollTick]);
  if (!b.checked) return null;

  const isVehicle = b.activity.pricingMode === 'vehicle';
  const showSuv = isVehicle && b.participants <= SIGHTSEEING_SUV_MAX;
  const dur = durationLabel(b.activity.durationMinutes);
  const whenText = b.date
    ? new Date(`${b.date}T00:00:00`).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';
  const occId = b.date ? b.days?.get(b.date)?.occurrenceId : undefined;

  function handleAddToCart() {
    if (!occId) return;
    // Capture the customised route (the tour page stashes it only when it diverges from the default),
    // so the cart line carries it to checkout — otherwise Add-to-cart silently books the default route.
    let itinerary: AltStop[] | undefined;
    try {
      const raw = window.sessionStorage.getItem(`gytm:itinerary:${b.activity.slug}`);
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr) && arr.length) itinerary = arr as AltStop[];
    } catch {
      /* sessionStorage unavailable — book the default route */
    }
    addToCart({
      id: `${occId}:${b.vehicleName ?? 'tour'}`,
      slug: b.activity.slug,
      title: b.activity.title,
      image: b.activity.image,
      occurrenceId: occId,
      dateLabel: whenText,
      lang: b.lang,
      // The real tier label (or vehicle name) — shared with Continue. NOT a hardcoded 'Adult', which
      // the server rejects (unknown_price_tier) for tours whose tier is e.g. 'Private group'.
      priceLabel: b.priceLabel,
      guests: b.totalGuests,
      // Per-unit price (the cart multiplies it by the party for per-head/per-group); the child-seat
      // add-on is carried separately so it isn't multiplied. Age-banded lines carry the whole party price
      // as a flat unit + the per-band map, so the cart + server price each band correctly.
      unitEur: b.unitPriceEur,
      pricingMode: b.activity.pricingMode,
      // Age-banded AND private lines carry the party map: it makes the cart price the line FLAT
      // (unitEur is already the whole-trip total for both) and locks the guest stepper — without it a
      // private €650 base displays as €650 × guests and lineCap clamps guests to the 1-trip pool.
      party: b.isAgeBanded || b.privateCfg ? b.party : undefined,
      suv: showSuv && b.suv,
      maxGuests: b.groupSize,
      seatsLeft: b.seatsLeft,
      unit: b.unitLabel,
      childSeats: b.childSeats,
      itinerary,
    });
    showToast({ title: t('Added to cart'), description: `${b.activity.title} — ${whenText}.` });
  }

  return (
    <div
      ref={cardRef}
      className="mt-6 mb-6 rounded-2xl border-2 border-teal/30 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.4)]"
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-teal">
        {b.activity.options.length > 1
          ? t('{count} options', { count: b.activity.options.length })
          : t('1 option available')}
      </div>

      {/* Multi-option picker — only renders for 2+ options; placed at the top of the card so the
          customer chooses their option before reviewing participants/date/price below. */}
      <OptionSelector />

      <h3 className="mt-1 font-display text-[19px] font-semibold text-ink">{b.activity.title}</h3>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink/80">
        {dur && (
          <span className="flex items-center gap-1.5">
            <IconClock width={15} height={15} className="text-teal" /> {dur}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <IconGlobe width={15} height={15} className="text-teal" /> {b.lang}
        </span>
        <span className="flex items-center gap-1.5">
          <IconPin width={15} height={15} className="text-teal" />
          {b.activity.pickupAvailable ? t('Hotel pickup') : t('Meeting point')}
        </span>
      </div>

      <div className="mt-4 border-t border-ink/10 pt-3">
        <div className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
          {t('Starting time')}
        </div>
        <div className="text-[15px] font-semibold text-ink">{whenText}</div>
      </div>

      {/* Recomputing the vehicle/price after a participants or date change: keep the card open but
          show it loading (dim + pulse) and block interaction until the new selection settles. */}
      <div
        aria-busy={b.updating}
        className={
          b.updating
            ? 'pointer-events-none animate-pulse opacity-50 transition-opacity duration-200'
            : 'transition-opacity duration-200'
        }
      >
        {showSuv && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => b.setSuv(false)}
              className={`flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-bold ${
                !b.suv ? 'border-teal bg-teal/5 text-teal-dark' : 'border-ink/15 text-ink-muted'
              }`}
            >
              {t('Sedan')} · {money(b.vehicleCfg.sedanEur)}
            </button>
            <button
              type="button"
              onClick={() => b.setSuv(true)}
              className={`flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-bold ${
                b.suv ? 'border-teal bg-teal/5 text-teal-dark' : 'border-ink/15 text-ink-muted'
              }`}
            >
              {t('SUV')} · {money(b.vehicleCfg.suvEur)}
            </button>
          </div>
        )}
        {isVehicle && b.vehicleName && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] font-semibold text-teal-dark">
            <IconUsers width={15} height={15} className="text-teal" />
            {b.vehicleName} ·{' '}
            {t('for {n} {noun}', {
              n: b.participants,
              noun: b.participants === 1 ? t('passenger') : t('passengers'),
            })}
          </div>
        )}

        {/* Baby/child seats — first free, €6 each extra. A seat is only for a child, so the stepper is
            capped at (and greyed out until) the party has a child/infant — see childSeatCap in the
            provider. Hidden entirely for adults-only activities (e.g. hiking — no children allowed). */}
        {!b.activity.adultsOnly &&
          (() => {
            const seatsDisabled = b.childSeatCap === 0;
            return (
              <div
                className={`mt-3 flex items-center justify-between gap-3 rounded-lg border border-ink/10 px-3 py-2.5 ${
                  seatsDisabled ? 'opacity-60' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-ink">{t('Baby & child seats')}</div>
                  <div className="text-[12px] text-ink-muted">
                    {seatsDisabled
                      ? t('Add a child or infant to the party to book a seat.')
                      : t('First seat free · {price} each extra', { price: money(CHILD_SEAT_EUR) })}
                    {!seatsDisabled && b.childSeatsExtra > 0 && (
                      <span className="font-semibold text-teal-dark">
                        {' '}
                        · +{money(b.childSeatsExtra)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    aria-label={t('Remove child seat')}
                    onClick={() => b.setChildSeats(Math.max(0, b.childSeats - 1))}
                    disabled={seatsDisabled || b.childSeats <= 0}
                    className="grid h-8 w-8 place-items-center rounded-full border border-ink/20 text-teal hover:border-teal disabled:opacity-40"
                  >
                    <IconMinus width={14} height={14} />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={b.childSeatCap}
                    value={b.childSeats}
                    disabled={seatsDisabled}
                    aria-label={t('Number of child seats')}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!Number.isNaN(n))
                        b.setChildSeats(Math.max(0, Math.min(b.childSeatCap, n)));
                    }}
                    className="h-8 w-12 rounded-lg border border-ink/15 text-center text-[14px] font-bold tabular-nums text-ink outline-none focus:border-teal disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    aria-label={t('Add child seat')}
                    onClick={() => b.setChildSeats(Math.min(b.childSeatCap, b.childSeats + 1))}
                    disabled={seatsDisabled || b.childSeats >= b.childSeatCap}
                    className="grid h-8 w-8 place-items-center rounded-full border border-ink/20 text-teal hover:border-teal disabled:opacity-40"
                  >
                    <IconPlus width={14} height={14} />
                  </button>
                </div>
              </div>
            );
          })()}

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-ink/10 pt-4">
          <div>
            <div className="text-[22px] font-extrabold tracking-tight text-ink">
              {b.total != null ? <Price eur={b.total} /> : '—'}
            </div>
            <div className="text-[12px] text-ink-muted">{t('All taxes and fees included')}</div>
          </div>
          <div className="flex flex-col items-stretch gap-2">
            <button
              type="button"
              disabled={b.busy || b.updating || b.total == null}
              onClick={() => void b.continueToCheckout()}
              className="gyt-press rounded-full bg-teal-dark px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:bg-teal-dark/85"
            >
              {b.busy ? t('Holding…') : t('Continue')}
            </button>
            <button
              type="button"
              onClick={handleAddToCart}
              className="gyt-press rounded-full border-2 border-teal px-7 py-2 text-[13px] font-bold text-teal-dark hover:bg-teal/5"
            >
              {t('Add to cart')}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink/80">
        <IconCheck width={15} height={15} className="text-teal" />{' '}
        {t('Free cancellation up to 24 hours before')}
      </div>
    </div>
  );
}
