'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Price } from '@/components/site/Price';
import { useT } from '@/components/site/PreferencesProvider';
import { parseApiJson } from '@/lib/http/fetch-json';
import {
  AIRPORT_FARE_DEFAULT,
  AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT,
  airportTransferQuote,
  airportVehicleLabel,
  centsToEur,
  eurToCents,
  type AirportFareByZone,
  type AirportZone,
  type TripType,
} from '@/lib/services/pricing';

const SLUG = 'airport-transfer';

// Brand hexes — kept literal so the card is pixel-faithful to the handoff.
const TEAL = '#0E8C92';
const TEAL_DARK = '#0B5C63';
const CORAL = '#F76C5E';
const INK = '#11201F';

const displayFont = { fontFamily: 'var(--font-at-display), sans-serif' } as const;

/**
 * Destination options. The select resolves to a pricing ZONE (zone2 = the near-airport south-east
 * cluster, zone1 = everywhere else) AND a representative hotel slug + map destination, so "Book this
 * transfer" can hand off into the real per-hotel booking widget (which completes the hold → checkout).
 * The guest confirms their EXACT hotel + date at that next step; this only carries the zone/vehicle/trip
 * they just priced. `slug` points at a live transfer page in that area; zone2's slug is a real Zone-2
 * hotel so the widget re-derives the same fare the guest saw here.
 */
interface DestOption {
  value: string;
  label: string;
  zone: AirportZone;
  /** A representative bookable hotel page for this area (the guest re-picks the exact hotel there). */
  slug: string;
  /** Map daddr for the route preview. */
  dest: string;
}

interface DestGroup {
  label: string;
  options: DestOption[];
}

function destGroups(t: (k: string) => string): DestGroup[] {
  return [
    {
      label: t('Near the airport (Zone 2)'),
      options: [
        {
          value: 'zone2',
          label: t('Mahébourg · Blue Bay · Pointe d’Esny · Grand Port · Ferney'),
          zone: 'zone2',
          slug: 'shandrani-beachcomber',
          dest: 'Blue Bay, Mauritius',
        },
      ],
    },
    {
      label: t('Elsewhere in Mauritius (Zone 1)'),
      options: [
        { value: 'z1-north', label: t('North — Grand Baie, Trou aux Biches'), zone: 'zone1', slug: 'trou-aux-biches-beachcomber', dest: 'Grand Baie, Mauritius' },
        { value: 'z1-east', label: t('East — Belle Mare, Trou d’Eau Douce'), zone: 'zone1', slug: 'lux-belle-mare', dest: 'Belle Mare, Mauritius' },
        { value: 'z1-west', label: t('West — Flic en Flac, Tamarin'), zone: 'zone1', slug: 'hilton-mauritius', dest: 'Flic-en-Flac, Mauritius' },
        { value: 'z1-central', label: t('Central — Moka, Curepipe, Quatre Bornes'), zone: 'zone1', slug: 'lux-belle-mare', dest: 'Curepipe, Mauritius' },
        { value: 'z1-south', label: t('South — Bel Ombre, Chamarel'), zone: 'zone1', slug: 'sofitel-so-mauritius', dest: 'Bel Ombre, Mauritius' },
        { value: 'z1-le-morne', label: t('Le Morne peninsula'), zone: 'zone1', slug: 'paradis-beachcomber', dest: 'Le Morne, Mauritius' },
      ],
    },
  ];
}

/** Vehicle / group-size brackets. `pax` is the representative party size used for the fare bracket
 *  (and prefilled into the booking widget); `suv` offers the ≤4 upgrade option. */
interface VehicleOption {
  value: string;
  label: string;
  pax: number;
  suv: boolean;
}

function vehicleOptions(t: (k: string) => string): VehicleOption[] {
  return [
    { value: 'standard', label: t('Standard car · up to 4'), pax: 4, suv: false },
    { value: 'suv', label: t('SUV · up to 4 (more luggage)'), pax: 4, suv: true },
    { value: 'family', label: t('Family · 5–6'), pax: 6, suv: false },
    { value: 'minibus', label: t('Minibus · 7–14'), pax: 14, suv: false },
    { value: 'coaster', label: t('Coaster · 15–25'), pax: 25, suv: false },
  ];
}

/** Stable, translation-free defaults so destOpt/vehicleOpt are never undefined (the live options carry
 *  the localized labels — these only need the value/zone/slug/pax fields). */
const DEFAULT_DEST: DestOption = {
  value: 'zone2',
  label: 'Near the airport (Zone 2)',
  zone: 'zone2',
  slug: 'shandrani-beachcomber',
  dest: 'Blue Bay, Mauritius',
};
const DEFAULT_VEHICLE: VehicleOption = { value: 'standard', label: 'Standard car · up to 4', pax: 4, suv: false };

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke={TEAL_DARK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Landing-page instant-price calculator. Sources the LIVE zone fare matrix + return discount the same
 * way the per-hotel widget does (`/api/v1/activities/airport-transfer` → airportFares / returnDiscountPct,
 * falling back to AIRPORT_FARE_DEFAULT), computes the fixed EUR price with airportTransferQuote(), and
 * shows the taxi-savings line. "Book this transfer" hands off to the chosen area's real booking page with
 * the priced party/vehicle/trip prefilled — the guest confirms their exact hotel + date there, and that
 * page's proven availability → hold → /checkout flow completes the booking.
 */
export function AirportQuote() {
  const t = useT();
  const router = useRouter();

  const groups = useMemo(() => destGroups(t), [t]);
  const vehicles = useMemo(() => vehicleOptions(t), [t]);

  const [dest, setDest] = useState('zone2');
  const [vehicleVal, setVehicleVal] = useState('standard');
  const [tripType, setTripType] = useState<TripType>('one_way');
  const [showMap, setShowMap] = useState(false);

  const [fares, setFares] = useState<AirportFareByZone>(AIRPORT_FARE_DEFAULT);
  const [returnPct, setReturnPct] = useState(AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT);

  // Live fare matrix + return discount, identical to TransferBookingWidget (so the price matches the
  // server cent-for-cent). Defaults stand if the activity/migration isn't live yet.
  useEffect(() => {
    let active = true;
    fetch(`/api/v1/activities/${SLUG}`)
      .then((r) => parseApiJson<{ airportFares?: AirportFareByZone; returnDiscountPct?: number }>(r))
      .then((body) => {
        if (!active || !body.ok) return;
        // Only adopt the live matrix if it's the ZONE-keyed shape this calculator prices against
        // (zone1/zone2). A pre-migration DB may still return a region-keyed matrix — in that case we
        // keep the bundled zone defaults so the price stays correct (the server reconciles at pay).
        const live = body.data?.airportFares;
        if (live && live.zone1 && live.zone2) setFares(live);
        if (typeof body.data?.returnDiscountPct === 'number') setReturnPct(body.data.returnDiscountPct);
      })
      .catch(() => {
        /* offline / not live yet — defaults stand; the server reconciles at pay */
      });
    return () => {
      active = false;
    };
  }, []);

  const allDest = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  // The lists are static and non-empty, so `find` always hits (`dest`/`vehicleVal` are seeded from a
  // member); the `?? DEFAULT_*` keeps the types non-undefined under noUncheckedIndexedAccess.
  const destOpt: DestOption = allDest.find((o) => o.value === dest) ?? DEFAULT_DEST;
  const vehicleOpt: VehicleOption = vehicles.find((v) => v.value === vehicleVal) ?? DEFAULT_VEHICLE;

  const priceEur = airportTransferQuote(destOpt.zone, vehicleOpt.pax, vehicleOpt.suv, tripType, fares, returnPct);
  // Taxi-savings line, mirroring the design: a metered airport/hotel taxi runs ~price/0.62.
  const taxiEur = centsToEur(Math.round(eurToCents(priceEur) / 0.62));
  const savingsEur = Math.max(0, taxiEur - priceEur);

  const vehicleName = airportVehicleLabel(vehicleOpt.pax, vehicleOpt.suv);
  const mapSrc =
    `https://maps.google.com/maps?saddr=${encodeURIComponent('SSR International Airport, Mauritius')}` +
    `&daddr=${encodeURIComponent(destOpt.dest)}&z=10&output=embed`;

  function book() {
    // Hand off to the chosen area's real booking page, carrying the priced party/vehicle/trip. The
    // per-hotel widget there completes availability → hold → /checkout (the real checkout, AT-2). The
    // guest re-confirms their exact hotel + date; the server re-derives the zone + price (zero-trust).
    const q = new URLSearchParams({
      party: String(vehicleOpt.pax),
      suv: vehicleOpt.suv ? '1' : '0',
      trip: tripType,
      from: 'quote',
    });
    router.push(`/airport-transfers/${destOpt.slug}?${q.toString()}`);
  }

  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '13px 40px 13px 14px',
    borderRadius: '12px',
    border: '1.5px solid rgba(11,92,99,0.22)',
    background: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    color: INK,
    appearance: 'none',
  };

  const segBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px 8px',
    borderRadius: '10px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: '13.5px',
    transition: 'all .18s ease',
    background: active ? TEAL : 'transparent',
    color: active ? '#fff' : TEAL_DARK,
    boxShadow: active ? '0 4px 12px rgba(14,140,146,0.3)' : 'none',
  });

  return (
    <div
      className="mx-auto max-w-[480px] rounded-[22px] border bg-white p-[clamp(22px,3vw,32px)]"
      style={{ borderColor: 'rgba(11,92,99,0.10)', boxShadow: '0 30px 70px -24px rgba(11,32,31,0.32)', color: INK }}
    >
      <div className="mb-[18px] flex items-center justify-between gap-3">
        <div className="text-[19px] font-bold tracking-[-0.01em]" style={displayFont}>
          {t('Your instant fixed price')}
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[12px] font-bold"
          style={{ color: TEAL, background: 'rgba(14,140,146,0.10)' }}
        >
          {t('No hidden fees')}
        </span>
      </div>

      {/* route line */}
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex items-center gap-1.5 text-[14px] font-bold" style={{ color: TEAL_DARK }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.8 19.2 16 11l3.5-3.5a2 2 0 1 0-2.8-2.8L13.2 8 5 6.2 3.5 7.7l5.5 3-2.5 2.5-2.5-.5L2.5 14l3.8 1.7L8 19.5z" />
          </svg>
          {t('MRU')}
        </span>
        <span className="h-px flex-1" style={{ background: `repeating-linear-gradient(to right, ${TEAL} 0 3px, transparent 3px 11px)` }} />
        <span className="flex items-center gap-1.5 text-[14px] font-bold" style={{ color: TEAL_DARK }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={CORAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
            <circle cx="12" cy="10" r="2.2" />
          </svg>
          {t('Your area')}
        </span>
      </div>

      {/* Destination → zone */}
      <label htmlFor="at-dest" className="mb-1.5 block text-[13px] font-bold" style={{ color: TEAL_DARK }}>
        {t('Airport → your area')}
      </label>
      <div className="relative mb-4">
        <select id="at-dest" value={dest} onChange={(e) => setDest(e.target.value)} style={selectStyle}>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">
          <Chevron />
        </span>
      </div>

      {/* Vehicle / group size */}
      <label htmlFor="at-vehicle" className="mb-1.5 block text-[13px] font-bold" style={{ color: TEAL_DARK }}>
        {t('Vehicle / group size')}
      </label>
      <div className="relative mb-4">
        <select id="at-vehicle" value={vehicleVal} onChange={(e) => setVehicleVal(e.target.value)} style={selectStyle}>
          {vehicles.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">
          <Chevron />
        </span>
      </div>

      {/* Trip type */}
      <div
        role="radiogroup"
        aria-label={t('Trip type')}
        className="mb-5 flex gap-1.5 rounded-[13px] p-1.5"
        style={{ background: 'rgba(11,92,99,0.07)' }}
      >
        <button type="button" role="radio" aria-checked={tripType === 'one_way'} onClick={() => setTripType('one_way')} style={segBtn(tripType === 'one_way')}>
          {t('One-way')}
        </button>
        <button type="button" role="radio" aria-checked={tripType === 'return'} onClick={() => setTripType('return')} style={segBtn(tripType === 'return')}>
          {returnPct > 0 ? t('Return (save {pct}%)', { pct: String(returnPct) }) : t('Return')}
        </button>
      </div>

      {/* Price + savings */}
      <div className="mb-1.5 flex items-end justify-between gap-3">
        <div>
          <div className="mb-0.5 text-[13px] font-semibold" style={{ color: '#3a4a49' }}>
            {tripType === 'return' ? t('Fixed return price') : t('Fixed one-way price')}
          </div>
          <div className="text-[clamp(38px,6vw,46px)] font-extrabold leading-none" style={{ ...displayFont, color: TEAL_DARK }}>
            <Price eur={priceEur} />
          </div>
        </div>
        {savingsEur > 0 && (
          <div className="rounded-xl border px-3 py-2 text-right" style={{ background: 'rgba(247,108,94,0.12)', borderColor: 'rgba(247,108,94,0.30)' }}>
            <div className="text-[12px] font-bold" style={{ color: '#c0392b' }}>
              {t('vs metered taxi')}
            </div>
            <div className="text-[18px] font-extrabold" style={{ color: CORAL }}>
              {t('Save ~')}
              <Price eur={savingsEur} />
            </div>
          </div>
        )}
      </div>
      <div className="mb-[18px] text-[12.5px]" style={{ color: '#5a6a69' }}>
        {t('Fixed, per vehicle · {vehicle} · includes meet & greet, name board & free waiting time.', { vehicle: vehicleName })}
      </div>

      <button
        type="button"
        onClick={book}
        className="flex w-full items-center justify-center gap-2.5 rounded-[14px] px-4 py-4 text-[17px] font-extrabold text-white"
        style={{ background: CORAL, boxShadow: '0 12px 26px -6px rgba(247,108,94,0.55)' }}
      >
        {t('Book this transfer')}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </button>

      {/* Lazy route preview (matches the design's embedded map, loaded on demand) */}
      <button
        type="button"
        onClick={() => setShowMap((s) => !s)}
        className="mt-3 w-full text-center text-[13.5px] font-bold underline underline-offset-2"
        style={{ color: TEAL_DARK }}
        aria-expanded={showMap}
      >
        {showMap ? t('Hide route preview') : t('Preview the route on a map')}
      </button>
      {showMap && (
        <div className="relative mt-3 aspect-[4/3] overflow-hidden rounded-2xl" style={{ background: '#dfeceb' }}>
          <iframe
            src={mapSrc}
            title={t('Route from SSR Airport to your area')}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="absolute inset-0 h-full w-full border-0"
          />
        </div>
      )}
    </div>
  );
}
