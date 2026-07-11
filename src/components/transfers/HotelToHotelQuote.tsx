'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Price } from '@/components/site/Price';
import { parseApiJson } from '@/lib/http/fetch-json';
import { transfers } from '@/lib/content/transfers';
import { TRANSFER_LOCATIONS } from '@/lib/content/transfer-locations';
import { whatsappUrl } from '@/lib/seo/site';
import {
  HOTEL_TRANSFER_FARE_DEFAULT,
  HOTEL_TRANSFER_RETURN_DISCOUNT_PCT_DEFAULT,
  REGION_DISTANCE_DEFAULT,
  areaRegion,
  hotelTransferQuote,
  regionDistanceBand,
  regionFromCoords,
  type HotelTransferFareByBand,
  type RegionDistanceMap,
  type TripType,
} from '@/lib/services/pricing';
import { useGoogleMaps } from '@/lib/maps/useGoogleMaps';

const SLUG = 'hotel-transfer';
const MAX_PARTY = 25;

const TEAL = '#0E8C92';
const TEAL_DARK = '#0B5C63';
const CORAL = '#F76C5E';
const INK = '#11201F';
const INK_SOFT = 'rgba(17,32,31,0.6)';
const displayFont = { fontFamily: 'var(--font-at-display), sans-serif' } as const;

const BAND_LABEL: Record<string, string> = {
  same: 'Same area',
  near: 'Nearby coast',
  far: 'Across the island',
};

/** A picked point: a listed hotel (priced by its known region), a Google Places pick (priced by the
 *  region of its coordinates), or a free-text/curated area (priced by the region classifier). `region`
 *  may be null for an unrecognised free-text place → priced at the far band. When `lat`/`lng` are set
 *  (a Google pick), the server re-derives the region from them (region_from_coords, zero-trust). */
interface LocPick {
  kind: 'hotel' | 'area';
  label: string;
  region: string | null;
  slug?: string;
  lat?: number;
  lng?: number;
}

const keyOf = (p: LocPick): string =>
  p.kind === 'hotel'
    ? `h:${p.slug}`
    : p.lat != null && p.lng != null
      ? `c:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
      : `a:${p.label.toLowerCase()}`;

/** Friendly vehicle class for a party size (+ the ≤4 SUV upgrade) — mirrors the band fare brackets. */
function vehicleLabel(party: number, suv: boolean): string {
  if (party <= 4) return suv ? 'SUV' : 'Standard car';
  if (party <= 6) return 'Family car';
  if (party <= 14) return 'Minibus';
  return 'Coaster';
}

/** Local YYYY-MM-DD (for the date input min + default). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Live Google Places autocomplete (restricted to Mauritius). The user types any hotel, resort, beach,
 * town or address; on pick we capture its coordinates + a clean label and derive the pricing region
 * from the coords (regionFromCoords) — the server re-derives the same region zero-trust at booking.
 */
function PlacesField({
  id,
  label,
  value,
  onSelect,
}: {
  id: string;
  label: string;
  value: LocPick | null;
  onSelect: (p: LocPick) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    let ac: google.maps.places.Autocomplete | null = null;
    try {
      ac = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'mu' },
        fields: ['name', 'formatted_address', 'geometry'],
      });
      ac.addListener('place_changed', () => {
        const p = ac!.getPlace();
        const loc = p.geometry?.location;
        if (!loc) return;
        const lat = loc.lat();
        const lng = loc.lng();
        const lbl = p.name || p.formatted_address || input.value || '';
        onSelectRef.current({
          kind: 'area',
          label: lbl,
          region: regionFromCoords(lat, lng),
          lat,
          lng,
        });
      });
    } catch {
      /* Places unavailable — the typeahead fallback (shown when Maps isn't ready) covers it */
    }
    return () => {
      if (ac) google.maps.event.clearInstanceListeners(ac);
    };
  }, []);

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className="text-[12px] font-bold uppercase tracking-wide"
        style={{ color: INK_SOFT }}
      >
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        defaultValue={value?.label ?? ''}
        autoComplete="off"
        placeholder="Hotel, resort, beach or town…"
        className="mt-1 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm font-semibold text-ink outline-none focus:border-teal"
        style={{ borderColor: 'rgba(17,32,31,0.15)' }}
      />
    </div>
  );
}

/**
 * The From/To field: live Google Places autocomplete when Maps is ready (any place in Mauritius), with
 * the curated hotel/town typeahead as a graceful fallback when it isn't. Reports the picked point back.
 */
function LocationField(props: {
  id: string;
  label: string;
  value: LocPick | null;
  onSelect: (p: LocPick) => void;
  excludeKey?: string;
}) {
  const status = useGoogleMaps();
  if (status === 'ready') {
    return (
      <PlacesField
        id={props.id}
        label={props.label}
        value={props.value}
        onSelect={props.onSelect}
      />
    );
  }
  return <TypeaheadField {...props} />;
}

/**
 * Curated typeahead matching listed hotels + well-known Mauritius places, with a free-text fallback.
 * Used when the Google Places script can't load, so the console always works. Reused for pickup + drop-off.
 */
function TypeaheadField({
  id,
  label,
  value,
  onSelect,
  excludeKey,
}: {
  id: string;
  label: string;
  value: LocPick | null;
  onSelect: (p: LocPick) => void;
  excludeKey?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo<LocPick[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const locs: LocPick[] = TRANSFER_LOCATIONS.filter((l) => l.label.toLowerCase().includes(s)).map(
      (l) => ({
        kind: 'area',
        label: l.label,
        region: l.region,
      }),
    );
    const hotels: LocPick[] = transfers
      .filter((t) => t.hotelName.toLowerCase().includes(s) || t.area.toLowerCase().includes(s))
      .map((t) => ({ kind: 'hotel', label: t.hotelName, region: t.region, slug: t.slug }));
    return [...locs, ...hotels].filter((p) => keyOf(p) !== excludeKey).slice(0, 8);
  }, [q, excludeKey]);

  // Free-text fallback when nothing matches: send the typed area, server re-derives the region.
  const freeText: LocPick | null = q.trim()
    ? { kind: 'area', label: q.trim(), region: areaRegion(q.trim()) }
    : null;

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className="text-[12px] font-bold uppercase tracking-wide"
        style={{ color: INK_SOFT }}
      >
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-controls={`${id}-list`}
        aria-expanded={open && q.trim() !== ''}
        aria-autocomplete="list"
        autoComplete="off"
        value={open ? q : (value?.label ?? q)}
        placeholder="Hotel, resort or town…"
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
          {matches.map((p) => (
            <li key={keyOf(p)} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  onSelect(p);
                  setOpen(false);
                  setQ('');
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-teal/10"
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold text-ink">{p.label}</span>
                  <span className="block text-[12px]" style={{ color: INK_SOFT }}>
                    {p.kind === 'hotel' ? 'Hotel' : 'Area'} ·{' '}
                    {p.region ? `${p.region} coast` : 'Mauritius'}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {freeText && !matches.some((m) => keyOf(m) === keyOf(freeText)) && (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  onSelect(freeText);
                  setOpen(false);
                  setQ('');
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-teal/10"
              >
                <span className="font-bold text-ink">Use “{freeText.label}”</span>
                <span className="text-[12px]" style={{ color: INK_SOFT }}>
                  · we’ll confirm the exact spot
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Point-to-point (location-to-location) transfer console. The guest picks TWO locations — a listed hotel
 * OR a town/area — plus party, trip and date; the price is the DISTANCE BAND between their regions
 * (same/near/far) × vehicle, computed exactly as the server does. "Book" runs the real on-site flow:
 * availability → hold → /checkout (the same path the airport widget uses), passing the two ends so the
 * server re-derives the regions zero-trust and recomputes the fare. If the transfer product isn't live
 * yet, it falls back to a pre-filled WhatsApp enquiry.
 */
export function HotelToHotelQuote() {
  const router = useRouter();
  const today = useMemo(() => ymd(new Date()), []);

  const [pickup, setPickup] = useState<LocPick | null>(null);
  const [dropoff, setDropoff] = useState<LocPick | null>(null);
  const [party, setParty] = useState(2);
  const [suv, setSuv] = useState(false);
  const [tripType, setTripType] = useState<TripType>('one_way');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [returnTime, setReturnTime] = useState('');
  const [fares, setFares] = useState<HotelTransferFareByBand>(HOTEL_TRANSFER_FARE_DEFAULT);
  const [distances, setDistances] = useState<RegionDistanceMap>(REGION_DISTANCE_DEFAULT);
  const [returnPct, setReturnPct] = useState(HOTEL_TRANSFER_RETURN_DISCOUNT_PCT_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notLive, setNotLive] = useState(false);

  // Live fares + region distances from the hotel-transfer activity (defaults stand if it isn't live yet;
  // the server reconciles the price at pay regardless).
  useEffect(() => {
    let active = true;
    fetch(`/api/v1/activities/${SLUG}`)
      .then((r) =>
        parseApiJson<{
          hotelTransferFares?: HotelTransferFareByBand;
          regionDistances?: RegionDistanceMap;
          returnDiscountPct?: number;
        }>(r),
      )
      .then((body) => {
        if (!active || !body.ok) return;
        const f = body.data?.hotelTransferFares;
        if (f && f.same && f.near && f.far) setFares(f);
        if (body.data?.regionDistances) setDistances(body.data.regionDistances);
        if (typeof body.data?.returnDiscountPct === 'number')
          setReturnPct(body.data.returnDiscountPct);
      })
      .catch(() => {
        /* not live yet — defaults stand */
      });
    return () => {
      active = false;
    };
  }, []);

  const suvEligible = party <= 4;
  const effectiveSuv = suv && suvEligible;
  const vehicle = vehicleLabel(party, effectiveSuv);
  const samePlace = Boolean(pickup && dropoff && keyOf(pickup) === keyOf(dropoff));
  const ready = Boolean(pickup && dropoff) && !samePlace;
  const band =
    pickup && dropoff ? regionDistanceBand(pickup.region, dropoff.region, distances) : null;
  const priceEur = ready
    ? hotelTransferQuote(
        pickup!.region,
        dropoff!.region,
        party,
        effectiveSuv,
        tripType,
        fares,
        distances,
        returnPct,
      )
    : 0;

  const waMessage = ready
    ? `Hi Belle Mare Tours! I'd like a private transfer from ${pickup!.label} to ${dropoff!.label} — ${vehicle}, ${tripType === 'return' ? 'return' : 'one-way'} (approx €${priceEur}). My dates are:`
    : 'Hi Belle Mare Tours! I’d like a private transfer between two locations. Here are the details:';

  async function book() {
    setError(null);
    setNotLive(false);
    if (!pickup || !dropoff) {
      setError('Choose your pickup and drop-off.');
      return;
    }
    if (samePlace) {
      setError('Pickup and drop-off must be different.');
      return;
    }
    if (!date) {
      setError('Please choose your pickup date.');
      return;
    }
    if (tripType === 'return' && !returnDate) {
      setError('Please choose your return date.');
      return;
    }
    setBusy(true);
    try {
      const avail = await fetch(
        `/api/v1/activities/${SLUG}/availability?from=${date}&to=${date}`,
      ).then((r) =>
        parseApiJson<Array<{ occurrenceId: string; startsAt: string; seatsLeft: number }>>(r),
      );
      const slots = avail.ok ? (avail.data ?? []) : [];
      const slot = slots.find((s) => (s.seatsLeft ?? 0) >= 1) ?? slots[0];
      if (!slot) {
        // Transfer product not published with availability yet — offer the WhatsApp fallback.
        setNotLive(true);
        setBusy(false);
        return;
      }
      const occ = slot.occurrenceId;
      const idem = crypto.randomUUID();
      let holdId = '';
      let expiresAt = '';
      try {
        const res = await fetch('/api/v1/holds', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            occurrenceId: occ,
            expectedSlug: SLUG,
            people: party,
            idempotencyKey: idem,
          }),
        }).then((r) => parseApiJson<{ holdId: string; expiresAt: string }>(r));
        if (res.ok) {
          holdId = res.data.holdId ?? '';
          expiresAt = res.data.expiresAt ?? '';
        }
      } catch {
        /* checkout will create the hold at pay if this failed */
      }
      try {
        window.sessionStorage.setItem(
          `gytm:hold:${occ}`,
          JSON.stringify({ holdId, expiresAt, idem }),
        );
      } catch {
        /* sessionStorage unavailable — checkout falls back to creating its own hold */
      }
      const dateText = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const q = new URLSearchParams({
        occ,
        slug: SLUG,
        label: 'Per transfer',
        qty: String(party),
        title:
          tripType === 'return'
            ? `Return transfer · ${pickup.label} ⇄ ${dropoff.label}`
            : `Transfer · ${pickup.label} → ${dropoff.label}`,
        lang: 'en',
        total: String(priceEur),
        when: tripType === 'return' ? `${dateText} (+ return)` : dateText,
        guests: String(party),
        unit: 'per transfer',
        suv: effectiveSuv ? '1' : '0',
        from: 'widget',
        // Hotel-to-hotel specifics — the server re-derives both regions from the slugs/areas (zero-trust).
        htransfer: '1',
        pickup: pickup.label,
        dropoff: dropoff.label,
        tripType,
      });
      if (pickup.kind === 'hotel' && pickup.slug) q.set('pickupSlug', pickup.slug);
      else q.set('pickupArea', pickup.label);
      if (dropoff.kind === 'hotel' && dropoff.slug) q.set('dropoffSlug', dropoff.slug);
      else q.set('dropoffArea', dropoff.label);
      // A Google Places pick carries coordinates → the server derives that end's region from them
      // (region_from_coords, zero-trust), more precisely than the keyword area classifier.
      if (pickup.lat != null && pickup.lng != null) {
        q.set('pickupLat', String(pickup.lat));
        q.set('pickupLng', String(pickup.lng));
      }
      if (dropoff.lat != null && dropoff.lng != null) {
        q.set('dropoffLat', String(dropoff.lat));
        q.set('dropoffLng', String(dropoff.lng));
      }
      if (date) q.set('arrDate', date);
      if (time) q.set('arr', time);
      if (tripType === 'return' && returnDate) q.set('retDate', returnDate);
      if (tripType === 'return' && returnTime) q.set('retTime', returnTime);
      router.push(`/checkout?${q.toString()}`);
    } catch {
      setError("We couldn't start your booking just now. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-2xl border bg-white p-5 text-left shadow-[0_18px_40px_-30px_rgba(10,46,54,0.45)] sm:p-6"
      style={{ borderColor: 'rgba(17,32,31,0.1)' }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LocationField
          id="h2h-from"
          label="From"
          value={pickup}
          onSelect={setPickup}
          excludeKey={dropoff ? keyOf(dropoff) : undefined}
        />
        <LocationField
          id="h2h-to"
          label="To"
          value={dropoff}
          onSelect={setDropoff}
          excludeKey={pickup ? keyOf(pickup) : undefined}
        />
      </div>

      {/* Trip type */}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div
            className="text-[12px] font-bold uppercase tracking-wide"
            style={{ color: INK_SOFT }}
          >
            Trip
          </div>
          <div
            className="mt-1.5 inline-flex rounded-full border p-1"
            style={{ borderColor: 'rgba(17,32,31,0.15)' }}
          >
            {(['one_way', 'return'] as const).map((tt) => (
              <button
                key={tt}
                type="button"
                onClick={() => setTripType(tt)}
                className="rounded-full px-4 py-1.5 text-[13px] font-bold transition"
                style={tripType === tt ? { background: TEAL, color: '#fff' } : { color: INK }}
              >
                {tt === 'one_way'
                  ? 'One-way'
                  : returnPct > 0
                    ? `Return (save ${returnPct}%)`
                    : 'Return'}
              </button>
            ))}
          </div>
        </div>

        {/* Passengers */}
        <div>
          <div
            className="text-[12px] font-bold uppercase tracking-wide"
            style={{ color: INK_SOFT }}
          >
            Passengers
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer passengers"
              onClick={() => setParty((p) => Math.max(1, p - 1))}
              disabled={party <= 1}
              className="grid h-9 w-9 place-items-center rounded-full border text-ink disabled:opacity-40"
              style={{ borderColor: 'rgba(17,32,31,0.15)' }}
            >
              −
            </button>
            <span className="min-w-8 text-center text-lg font-extrabold" style={{ color: INK }}>
              {party}
            </span>
            <button
              type="button"
              aria-label="More passengers"
              onClick={() => setParty((p) => Math.min(MAX_PARTY, p + 1))}
              disabled={party >= MAX_PARTY}
              className="grid h-9 w-9 place-items-center rounded-full border text-ink disabled:opacity-40"
              style={{ borderColor: 'rgba(17,32,31,0.15)' }}
            >
              +
            </button>
            <span className="ml-1 text-[13px]" style={{ color: INK_SOFT }}>
              {vehicle}
            </span>
          </div>
        </div>
      </div>

      {suvEligible && (
        <label
          className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-[13px] font-medium"
          style={{ color: INK }}
        >
          <input
            type="checkbox"
            checked={suv}
            onChange={(e) => setSuv(e.target.checked)}
            className="h-4 w-4 rounded text-teal focus:ring-teal"
          />
          SUV upgrade (more luggage space)
        </label>
      )}

      {/* Dates + times */}
      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label
            className="block text-[12px] font-bold uppercase tracking-wide"
            style={{ color: INK_SOFT }}
          >
            Pickup date
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-teal"
              style={{ borderColor: 'rgba(17,32,31,0.15)' }}
            />
          </label>
          <label
            className="block text-[12px] font-bold uppercase tracking-wide"
            style={{ color: INK_SOFT }}
          >
            Pickup time
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-teal"
              style={{ borderColor: 'rgba(17,32,31,0.15)' }}
            />
          </label>
        </div>
        {tripType === 'return' && (
          <div className="grid grid-cols-2 gap-3">
            <label
              className="block text-[12px] font-bold uppercase tracking-wide"
              style={{ color: INK_SOFT }}
            >
              Return date
              <input
                type="date"
                value={returnDate}
                min={date || today}
                onChange={(e) => setReturnDate(e.target.value)}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-teal"
                style={{ borderColor: 'rgba(17,32,31,0.15)' }}
              />
            </label>
            <label
              className="block text-[12px] font-bold uppercase tracking-wide"
              style={{ color: INK_SOFT }}
            >
              Return time
              <input
                type="time"
                value={returnTime}
                onChange={(e) => setReturnTime(e.target.value)}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-teal"
                style={{ borderColor: 'rgba(17,32,31,0.15)' }}
              />
            </label>
          </div>
        )}
      </div>

      {/* Price + CTA */}
      <div
        className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl p-4"
        style={{ background: 'rgba(14,140,146,0.07)' }}
      >
        <div>
          {samePlace ? (
            <div className="text-[14px] font-semibold text-coral">
              Pick two different locations.
            </div>
          ) : ready ? (
            <>
              <div
                className="text-[28px] font-extrabold leading-none"
                style={{ ...displayFont, color: INK }}
              >
                <Price eur={priceEur} />
              </div>
              <div className="mt-1 text-[12.5px]" style={{ color: INK_SOFT }}>
                Fixed price · {vehicle} · {tripType === 'return' ? 'return' : 'one-way'}
                {band ? ` · ${BAND_LABEL[band]}` : ''}
              </div>
            </>
          ) : (
            <div className="text-[14px] font-semibold" style={{ color: INK_SOFT }}>
              Pick both locations to see your fixed price.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={book}
          disabled={busy || !ready}
          aria-busy={busy}
          className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-extrabold text-white transition disabled:cursor-not-allowed"
          style={{
            background: ready ? CORAL : 'rgba(17,32,31,0.25)',
            boxShadow: ready ? '0 12px 26px -10px rgba(247,108,94,0.6)' : 'none',
          }}
        >
          {busy ? (
            <span
              className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-label="Loading"
              role="img"
            />
          ) : (
            'Book this transfer'
          )}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-coral-dark">
          {error}
        </p>
      )}
      {notLive && (
        <p className="mt-3 text-[13px] font-medium" style={{ color: INK_SOFT }}>
          That date isn’t open online just yet —{' '}
          <a
            href={whatsappUrl(waMessage)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold underline"
            style={{ color: TEAL_DARK }}
          >
            message us on WhatsApp
          </a>{' '}
          and we’ll set it up in minutes.
        </p>
      )}

      <p className="mt-3 text-[12.5px]" style={{ color: INK_SOFT }}>
        Fixed, all-in EUR price · same trusted driver-guide · door to door · free cancellation up to
        24h before.
      </p>
    </div>
  );
}
