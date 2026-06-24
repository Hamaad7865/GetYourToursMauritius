'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Price } from '@/components/site/Price';
import { parseApiJson } from '@/lib/http/fetch-json';
import { transfers, type Transfer } from '@/lib/content/transfers';
import { whatsappUrl } from '@/lib/seo/site';
import {
  HOTEL_TRANSFER_FARE_DEFAULT,
  HOTEL_TRANSFER_RETURN_DISCOUNT_PCT_DEFAULT,
  REGION_DISTANCE_DEFAULT,
  hotelTransferQuote,
  regionDistanceBand,
  type HotelTransferFareByBand,
  type RegionDistanceMap,
  type TripType,
} from '@/lib/services/pricing';

const SLUG = 'hotel-transfer';

const TEAL = '#0E8C92';
const TEAL_DARK = '#0B5C63';
const CORAL = '#F76C5E';
const INK = '#11201F';
const INK_SOFT = 'rgba(17,32,31,0.6)';
const displayFont = { fontFamily: 'var(--font-at-display), sans-serif' } as const;

interface VehicleOption {
  value: string;
  name: string;
  cap: string;
  pax: number;
  suv: boolean;
}
const VEHICLES: VehicleOption[] = [
  { value: 'standard', name: 'Standard car', cap: 'up to 4', pax: 4, suv: false },
  { value: 'suv', name: 'SUV', cap: 'up to 4 · more luggage', pax: 4, suv: true },
  { value: 'family', name: 'Family car', cap: '5–6 seats', pax: 6, suv: false },
  { value: 'minibus', name: 'Minibus', cap: '7–14 seats', pax: 14, suv: false },
  { value: 'coaster', name: 'Coaster', cap: '15–25 seats', pax: 25, suv: false },
];

const BAND_LABEL: Record<string, string> = { same: 'Same area', near: 'Nearby coast', far: 'Across the island' };

/** A hotel typeahead that reports the chosen hotel back (does not navigate). Reused for From + To. */
function HotelField({
  id,
  label,
  hotel,
  onSelect,
  excludeSlug,
}: {
  id: string;
  label: string;
  hotel: Transfer | null;
  onSelect: (t: Transfer) => void;
  excludeSlug?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo<Transfer[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return transfers
      .filter((t) => t.slug !== excludeSlug)
      .filter((t) => t.hotelName.toLowerCase().includes(s) || t.area.toLowerCase().includes(s))
      .slice(0, 7);
  }, [q, excludeSlug]);

  return (
    <div className="relative">
      <label htmlFor={id} className="text-[12px] font-bold uppercase tracking-wide" style={{ color: INK_SOFT }}>
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-controls={`${id}-list`}
        aria-expanded={open && matches.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
        value={open ? q : hotel?.hotelName ?? q}
        placeholder="Search a hotel or resort…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQ('');
          setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        className="mt-1 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm font-semibold text-ink outline-none focus:border-teal"
        style={{ borderColor: 'rgba(17,32,31,0.15)' }}
      />
      {open && q.trim() !== '' && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-xl border bg-white py-1 shadow-xl"
          style={{ borderColor: 'rgba(17,32,31,0.1)' }}
        >
          {matches.length === 0 ? (
            <li className="px-4 py-3 text-[13px]" style={{ color: INK_SOFT }}>
              No match — pick the nearest, or message us on WhatsApp for a custom quote.
            </li>
          ) : (
            matches.map((t) => (
              <li key={t.slug} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    onSelect(t);
                    setOpen(false);
                    setQ('');
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-teal/10"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-ink">{t.hotelName}</span>
                    <span className="block text-[12px]" style={{ color: INK_SOFT }}>
                      {t.area} · {t.region} coast
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Hotel-to-hotel instant-price console. The guest picks TWO hotels (from + to); the price is the DISTANCE
 * BAND between their regions (same/near/far) × vehicle, one-way or return — computed exactly as the server
 * does (hotelTransferQuote mirrors the SQL cent-for-cent). The live band fare table + region distances +
 * return discount come from /api/v1/activities/hotel-transfer (falling back to the bundled defaults). To
 * book, the guest sends the pre-filled details on WhatsApp and the team confirms the date + driver.
 */
export function HotelToHotelQuote() {
  const [from, setFrom] = useState<Transfer | null>(null);
  const [to, setTo] = useState<Transfer | null>(null);
  const [vehicleVal, setVehicleVal] = useState('standard');
  const [tripType, setTripType] = useState<TripType>('one_way');
  const [fares, setFares] = useState<HotelTransferFareByBand>(HOTEL_TRANSFER_FARE_DEFAULT);
  const [distances, setDistances] = useState<RegionDistanceMap>(REGION_DISTANCE_DEFAULT);
  const [returnPct, setReturnPct] = useState(HOTEL_TRANSFER_RETURN_DISCOUNT_PCT_DEFAULT);

  // Live fares + region distances from the hotel-transfer activity (defaults stand if it isn't live yet).
  useEffect(() => {
    fetch(`/api/v1/activities/${SLUG}`)
      .then((r) =>
        parseApiJson<{
          hotelTransferFares?: HotelTransferFareByBand;
          regionDistances?: RegionDistanceMap;
          returnDiscountPct?: number;
        }>(r),
      )
      .then((body) => {
        const f = body.data?.hotelTransferFares;
        if (f && f.same && f.near && f.far) setFares(f);
        if (body.data?.regionDistances) setDistances(body.data.regionDistances);
        if (typeof body.data?.returnDiscountPct === 'number') setReturnPct(body.data.returnDiscountPct);
      })
      .catch(() => {
        /* not live yet — defaults stand */
      });
  }, []);

  const vehicle = VEHICLES.find((v) => v.value === vehicleVal) ?? VEHICLES[0]!;
  const sameHotel = Boolean(from && to && from.slug === to.slug);
  const ready = Boolean(from && to) && !sameHotel;
  const band = from && to ? regionDistanceBand(from.region, to.region, distances) : null;
  const priceEur = ready
    ? hotelTransferQuote(from!.region, to!.region, vehicle.pax, vehicle.suv, tripType, fares, distances, returnPct)
    : 0;

  const waMessage = ready
    ? `Hi Belle Mare Tours! I'd like a hotel-to-hotel transfer from ${from!.hotelName} to ${to!.hotelName} — ${vehicle.name}, ${tripType === 'return' ? 'return' : 'one-way'} (approx €${priceEur}). My dates are:`
    : 'Hi Belle Mare Tours! I’d like a hotel-to-hotel transfer. Here are the two hotels and my dates:';

  return (
    <div
      className="rounded-2xl border bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.45)] sm:p-6"
      style={{ borderColor: 'rgba(17,32,31,0.1)' }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <HotelField id="h2h-from" label="From" hotel={from} onSelect={setFrom} excludeSlug={to?.slug} />
        <HotelField id="h2h-to" label="To" hotel={to} onSelect={setTo} excludeSlug={from?.slug} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wide" style={{ color: INK_SOFT }}>
            Vehicle
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {VEHICLES.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => setVehicleVal(v.value)}
                className="rounded-full border px-3.5 py-2 text-[13px] font-bold transition"
                style={
                  v.value === vehicleVal
                    ? { background: TEAL, borderColor: TEAL, color: '#fff' }
                    : { background: '#fff', borderColor: 'rgba(17,32,31,0.15)', color: INK }
                }
              >
                {v.name} <span className="font-medium opacity-70">· {v.cap}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wide" style={{ color: INK_SOFT }}>
            Trip
          </div>
          <div className="mt-1.5 inline-flex rounded-full border p-1" style={{ borderColor: 'rgba(17,32,31,0.15)' }}>
            {(['one_way', 'return'] as const).map((tt) => (
              <button
                key={tt}
                type="button"
                onClick={() => setTripType(tt)}
                className="rounded-full px-4 py-1.5 text-[13px] font-bold transition"
                style={tripType === tt ? { background: TEAL, color: '#fff' } : { color: INK }}
              >
                {tt === 'one_way' ? 'One-way' : 'Return'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl p-4"
        style={{ background: 'rgba(14,140,146,0.07)' }}
      >
        <div>
          {sameHotel ? (
            <div className="text-[14px] font-semibold text-coral">Pick two different hotels.</div>
          ) : ready ? (
            <>
              <div className="text-[28px] font-extrabold leading-none" style={{ ...displayFont, color: INK }}>
                <Price eur={priceEur} />
              </div>
              <div className="mt-1 text-[12.5px]" style={{ color: INK_SOFT }}>
                Fixed price · {vehicle.name} · {tripType === 'return' ? 'return' : 'one-way'}
                {band ? ` · ${BAND_LABEL[band]}` : ''}
              </div>
            </>
          ) : (
            <div className="text-[14px] font-semibold" style={{ color: INK_SOFT }}>
              Pick both hotels to see your fixed price.
            </div>
          )}
        </div>
        <a
          href={whatsappUrl(waMessage)}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!ready}
          className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-extrabold text-white no-underline"
          style={{
            background: ready ? CORAL : 'rgba(17,32,31,0.25)',
            pointerEvents: ready ? 'auto' : 'none',
            boxShadow: ready ? '0 12px 26px -10px rgba(247,108,94,0.6)' : 'none',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.2-5.6A8.4 8.4 0 1 1 21 11.5z" />
          </svg>
          Book on WhatsApp
        </a>
      </div>
      <p className="mt-3 text-[12.5px]" style={{ color: INK_SOFT }}>
        Fixed, all-in EUR price — same trusted driver-guide, door to door, booked direct with{' '}
        <span style={{ color: TEAL_DARK, fontWeight: 700 }}>Belle Mare Tours</span>. Send your dates on WhatsApp
        and we confirm in minutes.
      </p>
    </div>
  );
}
