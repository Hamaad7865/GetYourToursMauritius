'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RentalVehicle } from '@/lib/validation/rental';
import { rentalDays, rentalTotalEur } from '@/lib/services/pricing';
import { whatsappUrl } from '@/lib/seo/site';
import {
  IconCalendar,
  IconCheck,
  IconChat,
  IconPin,
  IconUsers,
  IconInfo,
} from '@/components/ui/icons';

/** Friendly label for a vehicle's class (free-text category → display). */
function categoryLabel(v: RentalVehicle): string {
  const c = v.category.toLowerCase();
  if (c === 'scooter') return 'Scooter';
  if (c === 'family') return 'Family car';
  if (c === 'economy' || c === 'compact') return 'Economy car';
  if (c === 'suv') return 'SUV';
  if (c === 'van') return 'Van';
  return v.category.charAt(0).toUpperCase() + v.category.slice(1);
}

const isScooter = (v: RentalVehicle) => v.category.toLowerCase() === 'scooter';

function euro(n: number): string {
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`;
}

/** Placeholder artwork when a vehicle has no photo yet — a branded gradient + a car / scooter glyph. */
function VehicleArt({ vehicle }: { vehicle: RentalVehicle }) {
  if (vehicle.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={vehicle.imageUrl}
        alt={vehicle.name}
        loading="lazy"
        // object-CONTAIN (not cover) on white: shows the WHOLE vehicle without cropping, and a photo on a
        // white/transparent background reads as just the car. Use cut-out or white-background photos.
        className="h-28 w-full rounded-xl bg-white object-contain"
      />
    );
  }
  return (
    <div className="flex h-28 w-full items-center justify-center rounded-xl bg-[linear-gradient(135deg,#0E8C92_0%,#13a0a6_60%,#5fc6c9_100%)] text-white/90">
      {isScooter(vehicle) ? (
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="5.5" cy="17.5" r="2.6" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="18.5" cy="17.5" r="2.6" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M8 17.5h7.9M16 7h2.2l1.6 5.2M16 7l-1 5.5M8 17.5l3-7H7.3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="50" height="50" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M3 13.5l1.6-4.2A2 2 0 016.5 8h11a2 2 0 011.9 1.3l1.6 4.2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M2.5 13.5h19v3.2a1 1 0 01-1 1h-1.3M5.8 17.7H4.5a1 1 0 01-1-1v-3.2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="7" cy="17.7" r="1.9" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="17" cy="17.7" r="1.9" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )}
    </div>
  );
}

function VehicleCard({
  vehicle,
  selected,
  onSelect,
}: {
  vehicle: RentalVehicle;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`relative flex flex-col gap-3 rounded-2xl border p-3 text-left transition ${
        selected
          ? 'border-teal ring-2 ring-teal/40 bg-teal/[0.04]'
          : 'border-ink/12 hover:border-teal/60 hover:bg-cream/40'
      }`}
    >
      {selected && (
        <span className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal text-white">
          <IconCheck width={14} height={14} />
        </span>
      )}
      <VehicleArt vehicle={vehicle} />
      <div>
        <p className="text-[15px] font-extrabold leading-tight text-ink">{vehicle.name}</p>
        {/* Wraps within the card on narrow widths (2–3 cards per row). Each "· item" is a nowrap group so
            a separator never lands orphaned at the start of a wrapped line, and the row can never spill
            past the card's right edge (the old single-line flex clipped "A/C"). */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-ink-muted">
          <span className="whitespace-nowrap">{categoryLabel(vehicle)}</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span aria-hidden>·</span>
            <IconUsers width={13} height={13} className="text-ink-muted" />
            {vehicle.seats}
          </span>
          {vehicle.transmission && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap capitalize">
              <span aria-hidden>·</span>
              {vehicle.transmission}
            </span>
          )}
          {vehicle.airCon && !isScooter(vehicle) && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span aria-hidden>·</span>
              A/C
            </span>
          )}
        </div>
      </div>
      <p className="mt-auto text-[15px] font-extrabold text-teal">
        {euro(vehicle.dailyRateEur)}
        <span className="text-[12.5px] font-semibold text-ink-muted"> / day</span>
      </p>
    </button>
  );
}

/** /rent fleet picker: choose a vehicle + dates + delivery, see days × rate, then hand off to WhatsApp
 *  with a ready-to-send message. No online payment — booking is confirmed over WhatsApp. */
export function RentalWidget({ vehicles }: { vehicles: RentalVehicle[] }) {
  const [selected, setSelected] = useState(vehicles[0]?.slug ?? '');
  const [pickup, setPickup] = useState('');
  const [ret, setRet] = useState('');
  const [delivery, setDelivery] = useState('');
  const [today, setToday] = useState('');

  // Default the dates client-side (avoids an SSR/CSR hydration mismatch from rendering "today" on the server).
  useEffect(() => {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const now = new Date();
    setToday(iso(now));
    setPickup((p) => p || iso(now));
    setRet((r) => r || iso(new Date(now.getTime() + 3 * 86_400_000)));
  }, []);

  const cars = useMemo(() => vehicles.filter((v) => !isScooter(v)), [vehicles]);
  const scooters = useMemo(() => vehicles.filter(isScooter), [vehicles]);
  const vehicle = vehicles.find((v) => v.slug === selected) ?? vehicles[0] ?? null;

  const datesValid = Boolean(
    pickup && ret && Date.parse(`${ret}T00:00:00Z`) >= Date.parse(`${pickup}T00:00:00Z`),
  );
  const days = datesValid ? rentalDays(pickup, ret) : 0;
  const total = vehicle && days ? rentalTotalEur(vehicle.dailyRateEur, days) : 0;
  const ready = Boolean(vehicle && datesValid);

  const message =
    vehicle && datesValid
      ? [
          `Hi Belle Mare Tours! I'd like to rent the ${vehicle.name}`,
          `(${categoryLabel(vehicle)}, ${vehicle.seats} seats) from ${pickup} to ${ret}`,
          `— ${days} day${days > 1 ? 's' : ''}, about ${euro(total)}.`,
          delivery.trim() ? `Deliver to: ${delivery.trim()}.` : 'Delivery: Belle Mare area (free).',
          'My name: ',
        ]
          .filter(Boolean)
          .join(' ')
      : '';

  if (!vehicle) return null;

  const fieldClass =
    'w-full rounded-xl border border-ink/15 bg-cream/40 px-3 py-2.5 text-sm text-ink outline-none focus:border-teal focus:bg-white';

  return (
    <section
      id="book"
      aria-label="Book a rental"
      className="grid gap-6 rounded-3xl border border-ink/10 bg-white p-5 shadow-[0_10px_40px_-24px_rgba(11,92,99,0.5)] sm:p-6 lg:grid-cols-[1.55fr_1fr]"
    >
      {/* Fleet */}
      <div role="radiogroup" aria-label="Choose a vehicle" className="flex flex-col gap-5">
        {cars.length > 0 && (
          <div>
            <h3 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.14em] text-ink-muted">
              Cars
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {cars.map((v) => (
                <VehicleCard
                  key={v.slug}
                  vehicle={v}
                  selected={v.slug === vehicle.slug}
                  onSelect={() => setSelected(v.slug)}
                />
              ))}
            </div>
          </div>
        )}
        {scooters.length > 0 && (
          <div>
            <h3 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.14em] text-ink-muted">
              Scooters
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {scooters.map((v) => (
                <VehicleCard
                  key={v.slug}
                  vehicle={v}
                  selected={v.slug === vehicle.slug}
                  onSelect={() => setSelected(v.slug)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Booking panel */}
      <div className="flex flex-col gap-3 rounded-2xl bg-cream/50 p-4">
        <p className="text-[15px] font-extrabold text-ink">
          Your {categoryLabel(vehicle).toLowerCase()}: {vehicle.name}
        </p>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="text-[12.5px] font-semibold text-ink">
            <span className="mb-1 flex items-center gap-1.5">
              <IconCalendar width={14} height={14} className="text-teal" /> Pick-up
            </span>
            <input
              type="date"
              className={fieldClass}
              value={pickup}
              min={today || undefined}
              onChange={(e) => {
                const v = e.target.value;
                setPickup(v);
                if (ret && Date.parse(`${ret}T00:00:00Z`) < Date.parse(`${v}T00:00:00Z`)) setRet(v);
              }}
            />
          </label>
          <label className="text-[12.5px] font-semibold text-ink">
            <span className="mb-1 flex items-center gap-1.5">
              <IconCalendar width={14} height={14} className="text-teal" /> Return
            </span>
            <input
              type="date"
              className={fieldClass}
              value={ret}
              min={pickup || today || undefined}
              onChange={(e) => setRet(e.target.value)}
            />
          </label>
        </div>

        <label className="text-[12.5px] font-semibold text-ink">
          <span className="mb-1 flex items-center gap-1.5">
            <IconPin width={14} height={14} className="text-teal" /> Delivery location
          </span>
          <input
            type="text"
            className={fieldClass}
            placeholder="Your hotel in the Belle Mare area (e.g. Lux Belle Mare)"
            value={delivery}
            onChange={(e) => setDelivery(e.target.value)}
          />
          <span className="mt-1 block text-[11.5px] font-normal text-ink-muted">
            We rent to guests staying in the Belle Mare area — free delivery &amp; collection there.
          </span>
        </label>

        {/* Price summary */}
        <div className="mt-1 rounded-xl border border-ink/10 bg-white p-3 text-sm">
          {datesValid ? (
            <>
              <div className="flex items-center justify-between text-ink">
                <span>
                  {euro(vehicle.dailyRateEur)} × {days} day{days > 1 ? 's' : ''}
                </span>
                <span className="text-[17px] font-extrabold text-ink">{euro(total)}</span>
              </div>
              <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-ink-muted">
                <IconCheck width={13} height={13} className="mt-0.5 shrink-0 text-teal" />
                Free delivery &amp; collection in the Belle Mare area.
                {vehicle.depositEur > 0
                  ? ` Refundable ${euro(vehicle.depositEur)} deposit at handover.`
                  : ' Deposit (if any) confirmed on WhatsApp.'}
              </p>
            </>
          ) : (
            <p className="flex items-start gap-1.5 text-[12.5px] text-ink-muted">
              <IconInfo width={14} height={14} className="mt-0.5 shrink-0 text-coral" />
              Pick a return date on or after the pick-up date to see your total.
            </p>
          )}
        </div>

        <a
          href={ready ? whatsappUrl(message) : undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!ready}
          onClick={(e) => {
            if (!ready) e.preventDefault();
          }}
          className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-white transition ${
            ready ? 'bg-teal hover:bg-teal-dark' : 'cursor-not-allowed bg-ink/25'
          }`}
        >
          <IconChat width={17} height={17} /> Book on WhatsApp
        </a>
        <p className="text-center text-[11.5px] text-ink-muted">
          No payment online — we confirm your dates and deposit over WhatsApp.
        </p>
      </div>
    </section>
  );
}
