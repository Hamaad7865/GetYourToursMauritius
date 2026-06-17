'use client';

import { useBooking } from './BookingProvider';
import { useCart } from '@/lib/cart/useCart';
import { useToast } from '@/components/site/ToastProvider';
import { durationLabel } from '@/lib/catalogue/detail';
import { IconCheck, IconClock, IconGlobe, IconPin, IconUsers } from '@/components/ui/icons';

function eur(n: number): string {
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`;
}

/** GetYourGuide "option available" card. Revealed after Check availability; shows the selection
 *  summary, the price, the Sedan/SUV choice (vehicle, ≤ blockSize), and Continue / Add to cart. */
export function BookingOptionCard() {
  const b = useBooking();
  const { add: addToCart } = useCart();
  const { showToast } = useToast();
  if (!b.checked) return null;

  const isVehicle = b.activity.pricingMode === 'vehicle';
  const showSuv = isVehicle && b.participants <= b.vehicleCfg.blockSize;
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
    addToCart({
      id: `${occId}:${b.vehicleName ?? 'tour'}`,
      slug: b.activity.slug,
      title: b.activity.title,
      image: b.activity.image,
      occurrenceId: occId,
      dateLabel: whenText,
      lang: b.lang,
      priceLabel: isVehicle ? (b.vehicleName ?? 'Vehicle') : 'Adult',
      guests: b.participants,
      unitEur: b.total ?? 0,
      pricingMode: b.activity.pricingMode,
      suv: showSuv && b.suv,
      maxGuests: null,
      seatsLeft: b.seatsLeft,
      unit: b.unitLabel,
    });
    showToast({ title: 'Added to cart', description: `${b.activity.title} — ${whenText}.` });
  }

  return (
    <div className="mb-6 rounded-2xl border-2 border-teal/30 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.4)]">
      <div className="text-[11px] font-bold uppercase tracking-wide text-teal">1 option available</div>
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
          {b.activity.pickupAvailable ? 'Hotel pickup' : 'Meeting point'}
        </span>
      </div>

      <div className="mt-4 border-t border-ink/10 pt-3">
        <div className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">Starting time</div>
        <div className="text-[15px] font-semibold text-ink">{whenText}</div>
      </div>

      {showSuv && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => b.setSuv(false)}
            className={`flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-bold ${
              !b.suv ? 'border-teal bg-teal/5 text-teal-dark' : 'border-ink/15 text-ink-muted'
            }`}
          >
            Sedan · {eur(b.vehicleCfg.perBlockEur)}
          </button>
          <button
            type="button"
            onClick={() => b.setSuv(true)}
            className={`flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-bold ${
              b.suv ? 'border-teal bg-teal/5 text-teal-dark' : 'border-ink/15 text-ink-muted'
            }`}
          >
            SUV · {eur(b.vehicleCfg.suvFlatEur)}
          </button>
        </div>
      )}
      {isVehicle && b.vehicleName && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] font-semibold text-teal-dark">
          <IconUsers width={15} height={15} className="text-teal" />
          {b.vehicleName} · for {b.participants} {b.participants === 1 ? 'passenger' : 'passengers'}
        </div>
      )}

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-ink/10 pt-4">
        <div>
          <div className="text-[22px] font-extrabold tracking-tight text-ink">
            {b.total != null ? eur(b.total) : '—'}
          </div>
          <div className="text-[12px] text-ink-muted">All taxes and fees included</div>
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <button
            type="button"
            disabled={b.busy || b.total == null}
            onClick={() => void b.continueToCheckout()}
            className="rounded-full bg-teal px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60"
          >
            {b.busy ? 'Holding…' : 'Continue'}
          </button>
          <button
            type="button"
            onClick={handleAddToCart}
            className="rounded-full border-2 border-teal px-7 py-2 text-[13px] font-bold text-teal-dark hover:bg-teal/5"
          >
            Add to cart
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink/80">
        <IconCheck width={15} height={15} className="text-teal" /> Free cancellation up to 24 hours before
      </div>
    </div>
  );
}
