'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Price } from '@/components/site/Price';
import { useT } from '@/components/site/PreferencesProvider';
import { parseApiJson } from '@/lib/http/fetch-json';
import {
  AIRPORT_FARE_DEFAULT,
  AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT,
  airportTransferQuoteMinor,
  airportVehicleLabel,
  airportZoneForSlug,
  centsToEur,
  type AirportFareByZone,
  type TripType,
} from '@/lib/services/pricing';
import {
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconClock,
  IconMinus,
  IconPin,
  IconPlus,
  IconUsers,
} from '@/components/ui/icons';

const SLUG = 'airport-transfer';
const MAX_PARTY = 25;

/** Local YYYY-MM-DD (for the date input min + default). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Bookable airport-transfer widget on each hotel page. The destination zone is fixed by the hotel, so
 * the price is an instant zone × vehicle (party-derived) fare, one-way or return. On "Book", it reserves
 * the day's availability and hands the selection to /checkout (where the traveller adds flight details and
 * pays). The server re-derives the zone from the hotel slug and recomputes the fare — the client price
 * is only a display hint, reconciled before charging. `region` stays a prop for SEO/display use elsewhere
 * but no longer drives pricing.
 */
export function TransferBookingWidget({
  slug,
  hotelName,
  region,
  durationMin,
}: {
  slug: string;
  hotelName: string;
  region: string;
  durationMin: number;
}) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();

  // Prefill from the landing-page quote calculator (?party=&suv=&trip=). The guest still confirms
  // the exact hotel + date here; these only set the opening party/vehicle/trip so the quote they saw
  // carries over. Clamped/validated so a hand-edited URL can't push the widget out of range.
  const prefillParty = (() => {
    const n = Number(params.get('party'));
    return Number.isFinite(n) && n >= 1 && n <= MAX_PARTY ? Math.floor(n) : 2;
  })();
  const prefillSuv = params.get('suv') === '1';
  const prefillTrip: TripType = params.get('trip') === 'return' ? 'return' : 'one_way';

  const today = useMemo(() => ymd(new Date()), []);
  const [party, setParty] = useState(prefillParty);
  const [suv, setSuv] = useState(prefillSuv);
  const [tripType, setTripType] = useState<TripType>(prefillTrip);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [returnTime, setReturnTime] = useState('');
  const [fares, setFares] = useState<AirportFareByZone>(AIRPORT_FARE_DEFAULT);
  const [returnPct, setReturnPct] = useState(AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull the live fare matrix + return discount so the shown price matches the server cent-for-cent
  // (falls back to the seeded defaults if the activity/migration isn't live yet).
  useEffect(() => {
    let active = true;
    fetch(`/api/v1/activities/${SLUG}`)
      .then((r) =>
        parseApiJson<{ airportFares?: AirportFareByZone; returnDiscountPct?: number }>(r),
      )
      .then((body) => {
        if (!active || !body.ok) return;
        // Only adopt the live matrix if it's the ZONE-keyed shape (zone1/zone2) the quote prices
        // against; a pre-migration DB may still return a region-keyed matrix, in which case the bundled
        // zone defaults stand (the server reconciles the price at pay regardless).
        const live = body.data?.airportFares;
        if (live && live.zone1 && live.zone2) setFares(live);
        if (typeof body.data?.returnDiscountPct === 'number')
          setReturnPct(body.data.returnDiscountPct);
      })
      .catch(() => {
        /* offline / not live yet — defaults stand; the server reconciles the price at pay */
      });
    return () => {
      active = false;
    };
  }, []);

  const suvEligible = party <= 4;
  const effectiveSuv = suv && suvEligible;
  const vehicle = airportVehicleLabel(party, effectiveSuv);
  // The destination zone is fixed by the hotel slug (the server re-derives it, zero-trust).
  const zone = airportZoneForSlug(slug);
  const totalMinor = airportTransferQuoteMinor(
    zone,
    party,
    effectiveSuv,
    tripType,
    fares,
    returnPct,
  );
  const totalEur = centsToEur(totalMinor);

  async function book() {
    setError(null);
    if (!date) {
      setError(t('Please choose your arrival date.'));
      return;
    }
    if (tripType === 'return' && !returnDate) {
      setError(t('Please choose your return date.'));
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
        setError(
          t("That date isn't open yet — please try another day, or contact us to arrange it."),
        );
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
      const transferTitle =
        tripType === 'return'
          ? `Return airport transfer · ${hotelName}`
          : `Airport transfer to ${hotelName}`;
      // Mirror the held transfer into the cart (same shape as Add-to-cart / the tour Book-now path), keyed
      // by occurrence, so leaving checkout keeps the held spot visible with its countdown. Checkout reads
      // gytm:cartline:{occ} on mount and upserts it as a held line; the cart's timer + reconcile + expiry
      // bell own it after. Vehicle pricing → the flat fare is the unit price and the party is fixed.
      try {
        window.sessionStorage.setItem(
          `gytm:cartline:${occ}`,
          JSON.stringify({
            id: `${occ}:transfer`,
            slug: SLUG,
            title: transferTitle,
            image: null,
            occurrenceId: occ,
            dateLabel: tripType === 'return' ? `${dateText} (+ return)` : dateText,
            lang: 'en',
            priceLabel: 'Transfer',
            guests: party,
            unitEur: totalEur,
            pricingMode: 'vehicle',
            suv: effectiveSuv,
            childSeats: 0,
            maxGuests: null,
            seatsLeft: slot.seatsLeft ?? party,
            unit: 'per transfer',
            idemKey: idem,
          }),
        );
      } catch {
        /* sessionStorage unavailable — the cart line just won't appear; checkout still works */
      }
      const q = new URLSearchParams({
        occ,
        slug: SLUG,
        label: 'Transfer',
        qty: String(party),
        title: transferTitle,
        lang: 'en',
        total: String(totalEur),
        when: tripType === 'return' ? `${dateText} (+ return)` : dateText,
        guests: String(party),
        unit: 'per transfer',
        suv: effectiveSuv ? '1' : '0',
        from: 'widget',
        // Airport-transfer specifics — the server re-derives the region from dropoffSlug (zero-trust).
        transfer: '1',
        dropoffSlug: slug,
        dropoff: hotelName,
        region,
        tripType,
      });
      // Carry the chosen arrival date/time so the checkout's leg fields prefill (the customer confirms
      // the exact hotel + flight numbers there). The server re-derives the price regardless.
      if (date) q.set('arrDate', date);
      if (time) q.set('arr', time);
      if (tripType === 'return' && returnDate) q.set('retDate', returnDate);
      if (tripType === 'return' && returnTime) q.set('retTime', returnTime);
      router.push(`/checkout?${q.toString()}`);
    } catch {
      setError(t("We couldn't start your booking just now. Please try again."));
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.45)]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-ink">{t('Book your transfer')}</h2>
        <span className="text-[12px] font-semibold text-ink-muted">~{durationMin} min</span>
      </div>
      {/* Origin is fixed to the airport; the hotel is the destination. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink/75">
        <IconPin width={14} height={14} className="shrink-0 text-coral" />
        <span className="font-semibold text-ink">{t('SSR Airport')}</span>
        <IconArrowRight width={13} height={13} className="text-ink/40" />
        <span className="min-w-0 truncate font-semibold text-ink">{hotelName}</span>
      </div>

      {/* Trip type */}
      <div role="radiogroup" aria-label={t('Trip type')} className="mt-4 grid grid-cols-2 gap-2">
        {(
          [
            ['one_way', t('One-way')],
            ['return', t('Return')],
          ] as Array<[TripType, string]>
        ).map(([value, lbl]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={tripType === value}
            onClick={() => setTripType(value)}
            className={`rounded-xl border px-3 py-2 text-[13.5px] font-bold transition ${
              tripType === value
                ? 'border-teal bg-teal/10 text-teal-dark'
                : 'border-ink/15 text-ink hover:border-ink/30'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>
      {tripType === 'return' && returnPct > 0 && (
        <p className="mt-2 text-[12px] font-medium text-teal-dark">
          {t('Save {pct}% when you book the return now.', { pct: String(returnPct) })}
        </p>
      )}

      {/* Passengers */}
      <div className="mt-4">
        <label className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <IconUsers width={15} height={15} className="text-teal" /> {t('Passengers')}
        </label>
        <div className="mt-1.5 flex items-center gap-3">
          <button
            type="button"
            aria-label={t('Fewer passengers')}
            onClick={() => setParty((p) => Math.max(1, p - 1))}
            disabled={party <= 1}
            className="grid h-9 w-9 place-items-center rounded-full border border-ink/15 text-ink disabled:opacity-40"
          >
            <IconMinus width={16} height={16} />
          </button>
          <span className="min-w-8 text-center text-lg font-extrabold text-ink">{party}</span>
          <button
            type="button"
            aria-label={t('More passengers')}
            onClick={() => setParty((p) => Math.min(MAX_PARTY, p + 1))}
            disabled={party >= MAX_PARTY}
            className="grid h-9 w-9 place-items-center rounded-full border border-ink/15 text-ink disabled:opacity-40"
          >
            <IconPlus width={16} height={16} />
          </button>
          <span className="ml-1 text-[13px] text-ink-muted">{vehicle}</span>
        </div>
      </div>

      {/* SUV upgrade (≤4 only) */}
      {suvEligible && (
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
          <input
            type="checkbox"
            checked={suv}
            onChange={(e) => setSuv(e.target.checked)}
            className="h-4 w-4 rounded border-ink/30 text-teal focus:ring-teal"
          />
          {t('SUV upgrade (more luggage space)')}
        </label>
      )}

      {/* Dates + times */}
      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[13px] font-semibold text-ink">
            <span className="flex items-center gap-1.5">
              <IconCalendar width={15} height={15} className="text-teal" /> {t('Arrival date')}
            </span>
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
            />
          </label>
          <label className="block text-[13px] font-semibold text-ink">
            <span className="flex items-center gap-1.5">
              <IconClock width={15} height={15} className="text-teal" /> {t('Arrival time')}
            </span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
            />
          </label>
        </div>
        {tripType === 'return' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[13px] font-semibold text-ink">
              <span className="flex items-center gap-1.5">
                <IconCalendar width={15} height={15} className="text-teal" /> {t('Return date')}
              </span>
              <input
                type="date"
                value={returnDate}
                min={date || today}
                onChange={(e) => setReturnDate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
              />
            </label>
            <label className="block text-[13px] font-semibold text-ink">
              <span className="flex items-center gap-1.5">
                <IconClock width={15} height={15} className="text-teal" /> {t('Pickup time')}
              </span>
              <input
                type="time"
                value={returnTime}
                onChange={(e) => setReturnTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
              />
            </label>
          </div>
        )}
      </div>

      {/* Price + CTA */}
      <div className="mt-5 flex items-end justify-between border-t border-ink/10 pt-4">
        <div>
          <div className="text-[12px] text-ink-muted">{t('Total')}</div>
          <div className="text-2xl font-extrabold text-ink">
            <Price eur={totalEur} />
          </div>
          <div className="text-[12px] text-ink-muted">
            {tripType === 'return' ? t('return · per vehicle') : t('one-way · per vehicle')}
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-coral-dark">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={book}
        disabled={busy}
        aria-busy={busy}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-teal-dark px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:bg-teal-dark/85"
      >
        {busy ? (
          <span
            role="img"
            aria-label={t('Loading')}
            className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        ) : (
          t('Book this transfer')
        )}
      </button>

      <ul className="mt-4 flex flex-col gap-1.5 text-[12.5px] text-ink/80">
        <li className="flex items-center gap-1.5">
          <IconPin width={14} height={14} className="text-teal" />{' '}
          {t('Meet & greet at SSR Airport arrivals')}
        </li>
        <li className="flex items-center gap-1.5">
          <IconClock width={14} height={14} className="text-teal" />{' '}
          {t('Flight tracking — free waiting if you’re delayed')}
        </li>
        <li className="flex items-center gap-1.5">
          <IconCheck width={14} height={14} className="text-teal" />{' '}
          {t('Fixed price · free cancellation up to 24h before')}
        </li>
      </ul>
    </div>
  );
}
