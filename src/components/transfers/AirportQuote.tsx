'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Price } from '@/components/site/Price';
import { useT } from '@/components/site/PreferencesProvider';
import { parseApiJson } from '@/lib/http/fetch-json';
import { useGoogleMaps } from '@/lib/maps/useGoogleMaps';
import { transfers, nearestTransfer, type Transfer } from '@/lib/content/transfers';
import {
  AIRPORT_FARE_DEFAULT,
  AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT,
  airportTransferQuote,
  airportZoneForSlug,
  centsToEur,
  eurToCents,
  type AirportFareByZone,
  type TripType,
} from '@/lib/services/pricing';

const SLUG = 'airport-transfer';

// Brand hexes — kept literal so the console is pixel-faithful to the page's palette.
const TEAL = '#0E8C92';
const TEAL_DARK = '#0B5C63';
const CORAL = '#F76C5E';
const GOLD = '#E9B949';
const CREAM = '#FBF7EF';
const INK = '#11201F';

const displayFont = { fontFamily: 'var(--font-at-display), sans-serif' } as const;

/** The opening hotel, so the price is instant on load (the guest searches to change it). LUX* Belle Mare
 *  is on-brand (the operator's home coast) and recognizable; fall back to the first hotel if the slug ever
 *  drops out of the dataset. */
const DEFAULT_HOTEL: Transfer = transfers.find((t) => t.slug === 'lux-belle-mare') ?? transfers[0]!;

/** Vehicle / group-size brackets. `pax` is the representative party size used for the fare bracket
 *  (and prefilled into the booking widget); `suv` offers the ≤4 upgrade option. `name`/`cap` label the chip. */
interface VehicleOption {
  value: string;
  name: string;
  cap: string;
  pax: number;
  suv: boolean;
}

function vehicleOptions(t: (k: string) => string): VehicleOption[] {
  return [
    { value: 'standard', name: t('Standard car'), cap: t('up to 4'), pax: 4, suv: false },
    { value: 'suv', name: t('SUV'), cap: t('up to 4 · more luggage'), pax: 4, suv: true },
    { value: 'family', name: t('Family car'), cap: t('5–6 seats'), pax: 6, suv: false },
    { value: 'minibus', name: t('Minibus'), cap: t('7–14 seats'), pax: 14, suv: false },
    { value: 'coaster', name: t('Coaster'), cap: t('15–25 seats'), pax: 25, suv: false },
  ];
}

const DEFAULT_VEHICLE: VehicleOption = {
  value: 'standard',
  name: 'Standard car',
  cap: 'up to 4',
  pax: 4,
  suv: false,
};

/** A capacity-appropriate vehicle glyph (car → van → coaster). */
function VehicleGlyph({ pax, color }: { pax: number; color: string }) {
  if (pax <= 6) {
    return (
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 16l1.3-4.4A2 2 0 0 1 8.2 10h7.6a2 2 0 0 1 1.9 1.6L19 16" />
        <path d="M3.5 16h17v2.2h-17z" />
        <circle cx="7.2" cy="18.6" r="1.3" />
        <circle cx="16.8" cy="18.6" r="1.3" />
      </svg>
    );
  }
  if (pax <= 14) {
    return (
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 7h11l3.5 3.5V16H4z" />
        <path d="M4 12h14.5" />
        <circle cx="8" cy="18" r="1.4" />
        <circle cx="16" cy="18" r="1.4" />
      </svg>
    );
  }
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="5" width="17" height="11" rx="2" />
      <path d="M3.5 12h17" />
      <circle cx="7.5" cy="18.4" r="1.3" />
      <circle cx="16.5" cy="18.4" r="1.3" />
    </svg>
  );
}

function SearchIcon({ color }: { color: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

/**
 * Landing-page instant-price console. The guest SEARCHES their hotel (typeahead over our covered resorts);
 * the destination zone is fixed by the chosen hotel's slug (`airportZoneForSlug` — exactly how the per-hotel
 * widget + server price it, so the quote is consistent cent-for-cent), and the fixed EUR fare appears
 * instantly for the chosen vehicle/trip. The live zone fare matrix + return discount come from
 * `/api/v1/activities/airport-transfer` (falling back to AIRPORT_FARE_DEFAULT). "Book this transfer" hands
 * off to the chosen hotel's real booking page with the priced party/vehicle/trip prefilled — the guest
 * confirms their date there, and that page's availability → hold → /checkout flow completes the booking.
 */
export function AirportQuote() {
  const t = useT();
  const router = useRouter();

  const vehicles = useMemo(() => vehicleOptions(t), [t]);

  const [hotel, setHotel] = useState<Transfer>(DEFAULT_HOTEL);
  const [query, setQuery] = useState(DEFAULT_HOTEL.hotelName);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-option refs so the vehicle/trip radiogroups can move focus with the arrow keys (ARIA radio pattern).
  const vehicleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tripRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [vehicleVal, setVehicleVal] = useState('standard');
  const [tripType, setTripType] = useState<TripType>('one_way');
  const [showMap, setShowMap] = useState(false);

  // When Google Maps is ready the hotel field becomes a live Places autocomplete (any hotel in Mauritius);
  // a picked place is snapped to the nearest listed hotel so the zone/price stays exact. Until then, the
  // curated typeahead over our covered resorts is used.
  const placesReady = useGoogleMaps() === 'ready';
  const atInputRef = useRef<HTMLInputElement>(null);

  const [fares, setFares] = useState<AirportFareByZone>(AIRPORT_FARE_DEFAULT);
  const [returnPct, setReturnPct] = useState(AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT);

  // Live fare matrix + return discount, identical to TransferBookingWidget (so the price matches the
  // server cent-for-cent). Defaults stand if the activity/migration isn't live yet.
  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/activities/${SLUG}`)
      .then((r) =>
        parseApiJson<{ airportFares?: AirportFareByZone; returnDiscountPct?: number }>(r),
      )
      .then((body) => {
        if (!alive || !body.ok) return;
        // Only adopt the live matrix if it's the ZONE-keyed shape this console prices against
        // (zone1/zone2). A pre-migration DB may still return a region-keyed matrix — keep the bundled
        // zone defaults so the price stays correct (the server reconciles at pay).
        const live = body.data?.airportFares;
        if (live && live.zone1 && live.zone2) setFares(live);
        if (typeof body.data?.returnDiscountPct === 'number')
          setReturnPct(body.data.returnDiscountPct);
      })
      .catch(() => {
        /* offline / not live yet — defaults stand; the server reconciles at pay */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Cancel a pending blur snap-back if we unmount mid-timer (e.g. a <Link> navigates away within 130ms).
  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  // Google Places autocomplete on the hotel field (when Maps is ready). The traveller can type ANY hotel;
  // on selection we snap to the geographically nearest listed hotel (same airport zone → same fixed price)
  // and reflect it in the field, so the priced/booked hotel always matches what's shown.
  useEffect(() => {
    if (!placesReady) return;
    const input = atInputRef.current;
    if (!input) return;
    let ac: google.maps.places.Autocomplete | null = null;
    try {
      ac = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'mu' },
        fields: ['name', 'geometry'],
      });
      ac.addListener('place_changed', () => {
        const loc = ac!.getPlace().geometry?.location;
        if (!loc) return;
        const n = nearestTransfer(loc.lat(), loc.lng());
        setHotel(n);
        setQuery(n.hotelName);
        setOpen(false);
        // Snap the field text to the priced hotel (the price ribbon + CTA all follow `hotel`).
        if (atInputRef.current) atInputRef.current.value = n.hotelName;
      });
    } catch {
      /* Places unavailable — the typeahead fallback covers it */
    }
    return () => {
      if (ac) google.maps.event.clearInstanceListeners(ac);
      // Google appends a .pac-container to <body> per Autocomplete and never removes it — every
      // client-side revisit stacked another. Only these widgets create them, so sweep them all.
      document.querySelectorAll('.pac-container').forEach((el) => el.remove());
    };
  }, [placesReady]);

  // Typeahead over the covered hotels (name or area). Empty query → no list (the field already shows the
  // current selection). The lists are static, so this is cheap to recompute per keystroke.
  const matches = useMemo<Transfer[]>(() => {
    const s = query.trim().toLowerCase();
    if (!s || s === hotel.hotelName.toLowerCase()) return [];
    return transfers
      .filter((x) => x.hotelName.toLowerCase().includes(s) || x.area.toLowerCase().includes(s))
      .slice(0, 7);
  }, [query, hotel.hotelName]);

  const vehicleOpt: VehicleOption = vehicles.find((v) => v.value === vehicleVal) ?? DEFAULT_VEHICLE;

  // The destination zone is fixed by the hotel slug — the server re-derives it (zero-trust). Same maths as
  // the per-hotel widget, so the price the guest sees here carries through to booking unchanged.
  const zone = airportZoneForSlug(hotel.slug);
  const priceEur = airportTransferQuote(
    zone,
    vehicleOpt.pax,
    vehicleOpt.suv,
    tripType,
    fares,
    returnPct,
  );
  // Taxi-savings line, mirroring the design: a metered airport/hotel taxi runs ~price/0.62.
  const taxiEur = centsToEur(Math.round(eurToCents(priceEur) / 0.62));
  const savingsEur = Math.max(0, taxiEur - priceEur);
  const fillPct = taxiEur > 0 ? Math.min(100, Math.round((priceEur / taxiEur) * 100)) : 100;
  const cheaperPct = taxiEur > 0 ? Math.round((savingsEur / taxiEur) * 100) : 0;

  /** A hotel's real "from" fare (standard car, one-way) off the LIVE zone matrix — accurate, unlike the
   *  looser region `fromPriceEur` label, and consistent with what the guest sees once it's selected. */
  const hotelFromEur = (x: Transfer) =>
    airportTransferQuote(airportZoneForSlug(x.slug), 4, false, 'one_way', fares, returnPct);

  const daddr =
    hotel.lat != null && hotel.lng != null
      ? `${hotel.lat},${hotel.lng}`
      : `${hotel.hotelName}, Mauritius`;
  const mapSrc =
    `https://maps.google.com/maps?saddr=${encodeURIComponent('SSR International Airport, Mauritius')}` +
    `&daddr=${encodeURIComponent(daddr)}&z=11&output=embed`;

  function pick(x: Transfer | undefined) {
    if (!x) return;
    setHotel(x);
    setQuery(x.hotelName);
    setOpen(false);
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(matches[active] ?? matches[0]);
    } else if (e.key === 'Escape') {
      // Close AND restore the field text to the priced hotel, so the input never contradicts the price.
      setOpen(false);
      setQuery(hotel.hotelName);
    }
  }

  // Arrow-key selection for the vehicle/trip radiogroups (the ARIA radio pattern: roving focus + select).
  function radioKeyDown(
    e: React.KeyboardEvent,
    values: readonly string[],
    current: string,
    setValue: (v: string) => void,
    refs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>,
  ) {
    const i = values.indexOf(current);
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % values.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (i - 1 + values.length) % values.length;
    else return;
    e.preventDefault();
    const nv = values[next]!;
    setValue(nv);
    refs.current[nv]?.focus();
  }

  function book() {
    // Hand off to the chosen hotel's real booking page, carrying the priced party/vehicle/trip. The
    // per-hotel widget there completes availability → hold → /checkout (the real checkout). The guest
    // confirms their date; the server re-derives the zone + price from the slug (zero-trust).
    const q = new URLSearchParams({
      party: String(vehicleOpt.pax),
      suv: vehicleOpt.suv ? '1' : '0',
      trip: tripType,
      from: 'quote',
    });
    router.push(`${hotel.path}?${q.toString()}`);
  }

  const fieldLabel = 'mb-2 block text-[12.5px] font-bold uppercase tracking-[0.13em]';

  return (
    <div
      className="mx-auto grid w-full max-w-[960px] grid-cols-1 overflow-hidden rounded-[28px] border md:grid-cols-[1.06fr_0.94fr]"
      style={{
        borderColor: 'rgba(17,32,31,0.10)',
        boxShadow: '0 36px 80px -30px rgba(11,32,31,0.40)',
        color: INK,
        background: '#fff',
      }}
    >
      <style>{`
        @keyframes aqPop { 0% { opacity: .25; transform: translateY(7px) scale(.965) } 100% { opacity: 1; transform: none } }
        .aq-pop { animation: aqPop .4s cubic-bezier(.16,1,.3,1) }
        .aq-fill { transition: width .6s cubic-bezier(.16,1,.3,1) }
        @media (prefers-reduced-motion: reduce) { .aq-pop { animation: none } .aq-fill { transition: none } }
      `}</style>

      {/* ─────────── LEFT · CONFIGURATOR ─────────── */}
      <div className="p-[clamp(22px,3vw,36px)]">
        <div className="mb-[22px] flex items-center justify-between gap-3">
          <span
            className="text-[13px] font-bold uppercase tracking-[0.16em]"
            style={{ color: TEAL }}
          >
            {t('Build your transfer')}
          </span>
          <span
            className="rounded-full px-2.5 py-1 text-[11.5px] font-bold"
            style={{ color: TEAL_DARK, background: 'rgba(14,140,146,0.10)' }}
          >
            {t('No hidden fees')}
          </span>
        </div>

        {/* Hotel search → zone */}
        <label htmlFor="at-hotel" className={fieldLabel} style={{ color: TEAL_DARK }}>
          {t('Airport → your hotel')}
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">
            <SearchIcon color={TEAL_DARK} />
          </span>
          {placesReady ? (
            // Google Places autocomplete (any hotel in Mauritius). Uncontrolled — Google manages the text
            // + its own dropdown; the place_changed effect snaps to the nearest listed hotel and rewrites
            // the field to it. defaultValue seeds the opening hotel so the price is instant on load.
            <input
              // Distinct keys on the two branches: without them React reuses the same DOM node when
              // Maps becomes ready and warns "changing a controlled input to be uncontrolled".
              key="at-hotel-places"
              id="at-hotel"
              ref={atInputRef}
              autoComplete="off"
              defaultValue={hotel.hotelName}
              placeholder={t('Search your hotel or resort…')}
              className="w-full rounded-[13px] border bg-white py-[13px] pl-11 pr-3.5 text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ borderColor: 'rgba(17,32,31,0.14)', color: INK, outlineColor: TEAL_DARK }}
            />
          ) : (
            <input
              key="at-hotel-typeahead"
              id="at-hotel"
              role="combobox"
              aria-expanded={open && matches.length > 0}
              aria-controls={open && matches.length > 0 ? 'at-hotel-list' : undefined}
              aria-activedescendant={
                open && matches.length > 0 ? `at-hotel-opt-${active}` : undefined
              }
              aria-autocomplete="list"
              autoComplete="off"
              value={query}
              placeholder={t('Search your hotel or resort…')}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setActive(0);
              }}
              onFocus={(e) => {
                setOpen(true);
                e.target.select();
              }}
              onBlur={() => {
                // Snap the field back to the current selection if they typed without picking — the price
                // never goes blank, and the input always reflects what's being priced.
                blurTimer.current = setTimeout(() => {
                  setOpen(false);
                  setQuery(hotel.hotelName);
                }, 130);
              }}
              onKeyDown={onKeyDown}
              className="w-full rounded-[13px] border bg-white py-[13px] pl-11 pr-3.5 text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ borderColor: 'rgba(17,32,31,0.14)', color: INK, outlineColor: TEAL_DARK }}
            />
          )}

          {!placesReady && open && matches.length > 0 && (
            <ul
              id="at-hotel-list"
              role="listbox"
              className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-[14px] border bg-white py-1.5"
              style={{
                borderColor: 'rgba(17,32,31,0.10)',
                boxShadow: '0 24px 50px -20px rgba(11,32,31,0.45)',
              }}
            >
              {matches.map((x, i) => (
                <li
                  key={x.slug}
                  id={`at-hotel-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                >
                  <button
                    type="button"
                    // onMouseDown (not onClick) so the pick fires before the input's onBlur closes the list.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(x);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
                    style={{ background: i === active ? 'rgba(14,140,146,0.10)' : 'transparent' }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-bold" style={{ color: INK }}>
                        {x.hotelName}
                      </span>
                      <span
                        className="block truncate text-[12px]"
                        style={{ color: 'rgba(17,32,31,0.7)' }}
                      >
                        {x.area} · {t('{region} coast', { region: t(x.region) })}
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-[12.5px] font-extrabold"
                      style={{ color: TEAL_DARK }}
                    >
                      {t('from')} <Price eur={hotelFromEur(x)} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!placesReady &&
            open &&
            matches.length === 0 &&
            query.trim() !== '' &&
            query.trim().toLowerCase() !== hotel.hotelName.toLowerCase() && (
              <div
                className="absolute z-30 mt-2 w-full rounded-[14px] border bg-white px-4 py-3 text-[13px]"
                style={{
                  borderColor: 'rgba(17,32,31,0.10)',
                  boxShadow: '0 24px 50px -20px rgba(11,32,31,0.45)',
                  color: 'rgba(17,32,31,0.6)',
                }}
              >
                {t('No match in our list.')}{' '}
                <Link
                  href="/contact"
                  className="font-bold underline"
                  style={{ color: TEAL_DARK }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {t('Message us for a quote')}
                </Link>
              </div>
            )}
          {/* Announce result count / no-match to screen readers as the query changes (the input keeps
              focus). Typeahead mode only — in Places mode Google owns the suggestions, and this region
              would keep announcing the FROZEN pre-swap query state. */}
          {!placesReady && (
            <div className="sr-only" role="status" aria-live="polite">
              {open &&
              query.trim() !== '' &&
              query.trim().toLowerCase() !== hotel.hotelName.toLowerCase()
                ? matches.length > 0
                  ? t('{n} hotels found', { n: String(matches.length) })
                  : t('No matching hotels')
                : ''}
            </div>
          )}
        </div>
        <div
          className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold"
          style={{ color: 'rgba(17,32,31,0.7)' }}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: zone === 'zone2' ? GOLD : TEAL }}
          />
          {t('≈{min} min from the airport · {region} coast', {
            min: String(hotel.durationMinFromAirport),
            region: t(hotel.region),
          })}
        </div>

        {/* Vehicle / group size */}
        <div className="mt-[22px]">
          <span className={fieldLabel} style={{ color: TEAL_DARK }}>
            {t('Vehicle / group size')}
          </span>
          <div
            role="radiogroup"
            aria-label={t('Vehicle / group size')}
            className="grid grid-cols-2 gap-2"
          >
            {vehicles.map((v) => {
              const on = v.value === vehicleVal;
              return (
                <button
                  key={v.value}
                  ref={(el) => {
                    vehicleRefs.current[v.value] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setVehicleVal(v.value)}
                  onKeyDown={(e) =>
                    radioKeyDown(
                      e,
                      vehicles.map((x) => x.value),
                      vehicleVal,
                      setVehicleVal,
                      vehicleRefs,
                    )
                  }
                  className="flex items-center gap-2.5 rounded-[13px] border p-[11px_12px] text-left transition-all duration-150"
                  style={{
                    borderColor: on ? TEAL : 'rgba(17,32,31,0.13)',
                    background: on ? 'rgba(14,140,146,0.08)' : '#fff',
                    boxShadow: on ? `inset 0 0 0 1px ${TEAL}` : 'none',
                  }}
                >
                  <VehicleGlyph pax={v.pax} color={on ? TEAL_DARK : 'rgba(17,32,31,0.5)'} />
                  <span className="min-w-0">
                    <span
                      className="block truncate text-[13.5px] font-bold leading-tight"
                      style={{ color: INK }}
                    >
                      {v.name}
                    </span>
                    <span
                      className="block truncate text-[11.5px] font-medium leading-tight"
                      style={{ color: 'rgba(17,32,31,0.62)' }}
                    >
                      {v.cap}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Trip type */}
        <div className="mt-[22px]">
          <span className={fieldLabel} style={{ color: TEAL_DARK }}>
            {t('Trip type')}
          </span>
          <div
            role="radiogroup"
            aria-label={t('Trip type')}
            className="flex gap-1.5 rounded-[13px] p-1.5"
            style={{ background: 'rgba(11,92,99,0.07)' }}
          >
            {(
              [
                ['one_way', t('One-way')],
                [
                  'return',
                  returnPct > 0
                    ? t('Return (save {pct}%)', { pct: String(returnPct) })
                    : t('Return'),
                ],
              ] as const
            ).map(([val, lbl]) => {
              const on = tripType === val;
              return (
                <button
                  key={val}
                  ref={(el) => {
                    tripRefs.current[val] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setTripType(val as TripType)}
                  onKeyDown={(e) =>
                    radioKeyDown(
                      e,
                      ['one_way', 'return'],
                      tripType,
                      (nv) => setTripType(nv as TripType),
                      tripRefs,
                    )
                  }
                  className="flex-1 rounded-[10px] border-none px-2 py-2.5 text-[13.5px] font-bold transition-all duration-150"
                  style={{
                    cursor: 'pointer',
                    background: on ? TEAL : 'transparent',
                    color: on ? '#fff' : TEAL_DARK,
                    boxShadow: on ? '0 5px 14px -4px rgba(14,140,146,0.45)' : 'none',
                  }}
                >
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─────────── RIGHT · PRICE STAGE ─────────── */}
      <div
        className="relative flex flex-col gap-5 p-[clamp(24px,3vw,36px)] text-white"
        style={{ background: `linear-gradient(158deg, ${TEAL_DARK} 0%, #0a4a50 52%, ${INK} 100%)` }}
      >
        {/* Route ribbon */}
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-bold"
            style={{ color: CREAM }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke={GOLD}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17.8 19.2 16 11l3.5-3.5a2 2 0 1 0-2.8-2.8L13.2 8 5 6.2 3.5 7.7l5.5 3-2.5 2.5-2.5-.5L2.5 14l3.8 1.7L8 19.5z" />
            </svg>
            {t('MRU')}
          </span>
          <span
            className="h-px flex-1"
            style={{
              background:
                'repeating-linear-gradient(to right, rgba(251,247,239,0.6) 0 3px, transparent 3px 10px)',
            }}
          />
          <span
            className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-bold"
            style={{ color: CREAM }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={CORAL}
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.2" />
            </svg>
            <span className="truncate">{hotel.hotelName}</span>
          </span>
        </div>

        {/* Price */}
        <div>
          <div
            className="mb-1 text-[12.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: 'rgba(251,247,239,0.82)' }}
          >
            {tripType === 'return' ? t('Fixed return price') : t('Fixed one-way price')}
          </div>
          <div
            key={`${priceEur}-${tripType}-${vehicleVal}-${hotel.slug}`}
            className="aq-pop flex items-end gap-2"
          >
            <span
              className="text-[clamp(46px,7vw,60px)] font-extrabold leading-[0.95]"
              style={{ ...displayFont, color: CREAM }}
            >
              <Price eur={priceEur} />
            </span>
          </div>
          <div
            className="mt-1.5 text-[13px] font-medium"
            style={{ color: 'rgba(251,247,239,0.72)' }}
          >
            {t('per vehicle')} · {vehicleOpt.name}
          </div>
        </div>

        {/* Savings meter — the signature: a proportional bar showing what you pay vs a metered taxi */}
        {savingsEur > 0 && (
          <div
            className="rounded-[16px] p-[15px_16px]"
            style={{ background: 'rgba(4,28,32,0.34)', border: '1px solid rgba(251,247,239,0.14)' }}
          >
            <div className="mb-2.5 flex items-baseline justify-between">
              <span
                className="text-[12px] font-bold uppercase tracking-[0.12em]"
                style={{ color: 'rgba(251,247,239,0.66)' }}
              >
                {t('How it compares')}
              </span>
              <span
                className="text-[12.5px] font-semibold"
                style={{ color: 'rgba(251,247,239,0.62)' }}
              >
                <span style={{ textDecoration: 'line-through' }}>
                  <Price eur={taxiEur} />
                </span>{' '}
                {t('Metered airport taxi')}
              </span>
            </div>
            <div
              className="relative h-9 overflow-hidden rounded-[10px]"
              style={{ background: 'rgba(247,108,94,0.22)' }}
            >
              <div
                className="aq-fill absolute inset-y-0 left-0 flex items-center rounded-[10px] pl-3"
                style={{
                  width: `${fillPct}%`,
                  background: `linear-gradient(90deg, ${TEAL}, #16a39a)`,
                }}
              >
                <span
                  className="whitespace-nowrap text-[12.5px] font-extrabold"
                  style={{ color: '#fff' }}
                >
                  {t('You pay')} <Price eur={priceEur} />
                </span>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-extrabold"
                style={{ background: GOLD, color: INK }}
              >
                {t('Save ~')}
                <Price eur={savingsEur} />
              </span>
              {cheaperPct > 0 && (
                <span className="text-[12.5px] font-bold" style={{ color: GOLD }}>
                  {t('≈{pct}% cheaper', { pct: String(cheaperPct) })}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Inclusions */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {[t('Meet & greet'), t('Flight tracking'), t('Free waiting')].map((it) => (
            <span
              key={it}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold"
              style={{ color: 'rgba(251,247,239,0.85)' }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke={GOLD}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m5 13 4 4L19 7" />
              </svg>
              {it}
            </span>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-auto">
          <button
            type="button"
            onClick={book}
            className="flex w-full items-center justify-center gap-2.5 rounded-[14px] px-4 py-[15px] text-[17px] font-extrabold text-white transition-transform duration-150 hover:-translate-y-0.5"
            style={{ background: CORAL, boxShadow: '0 14px 30px -8px rgba(247,108,94,0.6)' }}
          >
            {t('Book this transfer')}
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </button>
          <div
            className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[12px] font-semibold"
            style={{ color: 'rgba(251,247,239,0.82)' }}
          >
            <span>{t('Free cancellation 24h')}</span>
            <span aria-hidden="true">·</span>
            <span>{t('Pay securely by card')}</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setShowMap((s) => !s)}
              className="underline underline-offset-2"
              style={{ color: CREAM }}
              aria-expanded={showMap}
            >
              {showMap ? t('Hide route preview') : t('Preview the route on a map')}
            </button>
          </div>
        </div>
      </div>

      {/* ─────────── ROUTE PREVIEW (full-width strip, on demand) ─────────── */}
      {showMap && (
        <div
          className="md:col-span-2"
          style={{ borderTop: '1px solid rgba(17,32,31,0.10)', background: '#dfeceb' }}
        >
          <div className="relative aspect-[16/7]">
            <iframe
              src={mapSrc}
              title={t('Route from SSR Airport to {hotel}', { hotel: hotel.hotelName })}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="absolute inset-0 h-full w-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}
