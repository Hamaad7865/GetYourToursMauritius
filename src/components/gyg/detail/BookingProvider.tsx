'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TourType } from '@/lib/validation/common';
import type { PricingMode, TourOption, VehiclePricing } from '@/lib/validation/tours';
import {
  sightseeingQuote,
  childSeatsCost,
  SIGHTSEEING_DEFAULT,
  SIGHTSEEING_SUV_MAX,
} from '@/lib/services/pricing';
import { nominalDayKey, utcDayKey } from '@/lib/services/day-key';

export interface BookingActivity {
  slug: string;
  type: TourType;
  title: string;
  fromPriceEur: number | null;
  options: TourOption[];
  languages: string[];
  pricingMode: PricingMode;
  vehiclePricing: VehiclePricing | null;
  durationMinutes: number | null;
  pickupAvailable: boolean;
  image: string | null;
}

interface DayInfo {
  occurrenceId: string;
  seatsLeft: number;
}

interface BookingState {
  activity: BookingActivity;
  participants: number;
  setParticipants: (n: number) => void;
  date: string; // 'YYYY-MM-DD'
  setDate: (d: string) => void;
  lang: string;
  setLang: (l: string) => void;
  suv: boolean;
  setSuv: (b: boolean) => void;
  /** Child seats requested (first free, €6 each extra). Bounded to the party size. */
  childSeats: number;
  setChildSeats: (n: number) => void;
  /** The child-seat add-on cost in EUR (already included in `total`). */
  childSeatsExtra: number;
  days: Map<string, DayInfo> | null;
  checked: boolean;
  setChecked: (b: boolean) => void;
  /** Reveal the option card AND request it be scrolled into view (bumps on every press, so pressing
   *  "Check availability" again from anywhere on the page re-centres the already-open card). */
  checkAvailability: () => void;
  /** Increments each time the card is asked to scroll into view; the card watches this. */
  scrollTick: number;
  /** The booking option id used for availability + checkout. */
  bookingOptionId: string | null;
  vehicleCfg: VehiclePricing;
  /** Cheapest tier's max_guests (per-group "up to N"), null otherwise. */
  groupSize: number | null;
  /** Seats/vehicles left on the selected date (0 if none). */
  seatsLeft: number;
  /** Largest party the current date + mode allow. */
  maxParticipants: number;
  /** Display unit: "per vehicle" / "per group up to N" / "per person". */
  unitLabel: string;
  /** Live total for the current selection, or null if not computable. */
  total: number | null;
  /** The per-UNIT price (per vehicle / per group / per head), excluding the child-seat add-on — what
   *  the cart stores so it isn't double-multiplied by the party. */
  unitPriceEur: number;
  vehicleName: string | null;
  /** The price-tier label the cart + checkout must post to the server: the cheapest tier's REAL
   *  label (per-person / per-group) or the vehicle name. Add-to-cart and Continue share this single
   *  source so they can't diverge — a hardcoded 'Adult' here broke checkout for any tour whose tier
   *  isn't literally 'Adult' (e.g. 'Private group', 'Per transfer', 'Per day'). */
  priceLabel: string;
  busy: boolean;
  /** Brief "recomputing" flag for the option card while the selection changes. */
  updating: boolean;
  /** Flag the option card as updating (called when participants/date change). */
  touch: () => void;
  /** Continue: reserve the spot, then route to checkout. */
  continueToCheckout: () => Promise<void>;
}

const Ctx = createContext<BookingState | null>(null);
export const useBooking = (): BookingState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBooking must be used within BookingProvider');
  return v;
};

export function BookingProvider({
  activity,
  children,
}: {
  activity: BookingActivity;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [participants, setParticipants] = useState(2);
  const [date, setDate] = useState('');
  const [lang, setLang] = useState(activity.languages[0] ?? 'English');
  const [suv, setSuv] = useState(false);
  const [childSeats, setChildSeats] = useState(0);
  const [checked, setChecked] = useState(false);
  const [scrollTick, setScrollTick] = useState(0);
  // Reveal the card and (re)request a scroll-into-view. Bumping the tick on every press means a
  // second press from further down the page re-centres the card even though `checked` is unchanged.
  const checkAvailability = useCallback(() => {
    setChecked(true);
    setScrollTick((t) => t + 1);
  }, []);
  const [days, setDays] = useState<Map<string, DayInfo> | null>(null);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Briefly flag the option card as "updating" when the selection changes, instead of closing it.
  const touch = useCallback(() => {
    setUpdating(true);
    if (updTimer.current) clearTimeout(updTimer.current);
    updTimer.current = setTimeout(() => setUpdating(false), 350);
  }, []);
  useEffect(() => () => {
    if (updTimer.current) clearTimeout(updTimer.current);
  }, []);

  const isVehicle = activity.pricingMode === 'vehicle';
  const vehicleCfg = activity.vehiclePricing ?? SIGHTSEEING_DEFAULT;

  // Cheapest price tier drives the bookable option id + per-person/per-group price.
  const cheapest = useMemo(() => {
    let best: { optionId: string; label: string; amountEur: number; maxGuests: number | null } | null = null;
    for (const o of activity.options) {
      for (const p of o.prices) {
        if (!best || p.amountEur < best.amountEur) {
          best = { optionId: o.id, label: p.label, amountEur: p.amountEur, maxGuests: p.maxGuests };
        }
      }
    }
    return best;
  }, [activity.options]);
  const bookingOptionId = isVehicle ? (activity.options[0]?.id ?? null) : (cheapest?.optionId ?? null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  useEffect(() => {
    if (!bookingOptionId) {
      setDays(new Map());
      return;
    }
    let active = true;
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 180);
    fetch(`/api/v1/activities/${activity.slug}/availability?from=${nominalDayKey(today)}&to=${nominalDayKey(horizon)}`)
      .then((r) => r.json())
      .then((body) => {
        if (!active) return;
        const map = new Map<string, DayInfo>();
        if (body.ok) {
          for (const s of body.data as Array<{
            occurrenceId: string;
            activityOptionId: string;
            startsAt: string;
            seatsLeft: number;
          }>) {
            if (s.activityOptionId !== bookingOptionId) continue;
            map.set(utcDayKey(s.startsAt), { occurrenceId: s.occurrenceId, seatsLeft: s.seatsLeft });
          }
        }
        setDays(map);
      })
      .catch(() => active && setDays(new Map()));
    return () => {
      active = false;
    };
  }, [activity.slug, bookingOptionId, today]);

  const groupSize = activity.pricingMode === 'per_group' ? (cheapest?.maxGuests ?? null) : null;
  const seatsLeft = (date ? days?.get(date)?.seatsLeft : undefined) ?? 0;
  const tierCap = activity.pricingMode === 'per_person' && cheapest?.maxGuests ? cheapest.maxGuests : Infinity;
  const maxParticipants = isVehicle
    ? Math.max(1, vehicleCfg.maxParty)
    : Math.max(1, Math.min(16, tierCap, date ? seatsLeft : 16));
  const unitLabel = isVehicle
    ? 'per vehicle'
    : groupSize
      ? `per group up to ${groupSize}`
      : activity.type === 'transport'
        ? 'per vehicle'
        : 'per person';
  const suvActive = isVehicle && suv && participants <= SIGHTSEEING_SUV_MAX;

  // Clamp the party down when the cap drops (e.g. switching to a date with fewer seats), so an
  // over-capacity selection never reaches Check availability / checkout.
  useEffect(() => {
    if (participants > maxParticipants) setParticipants(maxParticipants);
  }, [participants, maxParticipants]);
  // Reset the SUV upgrade once the party grows past the entry tier, so dropping back to ≤ 4 starts
  // from Sedan instead of silently snapping the price back to the SUV rate.
  useEffect(() => {
    if (isVehicle && suv && participants > SIGHTSEEING_SUV_MAX) setSuv(false);
  }, [isVehicle, suv, participants]);
  // Can't request more child seats than passengers.
  useEffect(() => {
    if (childSeats > participants) setChildSeats(participants);
  }, [childSeats, participants]);
  const vehicleQuote = isVehicle
    ? sightseeingQuote(Math.min(Math.max(participants, 1), vehicleCfg.maxParty), suvActive, vehicleCfg)
    : null;
  const baseTotal = isVehicle
    ? (vehicleQuote?.totalEur ?? null)
    : cheapest == null
      ? null
      : activity.pricingMode === 'per_group'
        ? // One flat price per group of `groupSize`; if the group size is somehow missing (bad data),
          // charge a single group rather than silently billing per head (the server rejects an
          // unconfigured per_group tier outright, so this only guards the display).
          cheapest.amountEur * (groupSize ? Math.ceil(participants / groupSize) : 1)
        : cheapest.amountEur * participants;
  const childSeatsExtra = childSeatsCost(childSeats);
  const total = baseTotal == null ? null : baseTotal + childSeatsExtra;
  // Per-unit price for the cart: a vehicle is one flat unit (its whole price); per-group / per-person
  // is the tier's unit price (the cart multiplies it by the party). Never includes the child add-on.
  const unitPriceEur = isVehicle ? (baseTotal ?? 0) : (cheapest?.amountEur ?? 0);
  const vehicleName = vehicleQuote?.vehicle ?? null;
  // Single source of the price-tier label for BOTH Continue and Add-to-cart. They used to diverge:
  // Add-to-cart hardcoded 'Adult', which the server rejects (unknown_price_tier) for any tour whose
  // cheapest tier isn't labelled 'Adult'.
  const priceLabel = isVehicle ? (vehicleName ?? 'Vehicle') : (cheapest?.label ?? '');

  async function continueToCheckout() {
    const occ = date ? days?.get(date)?.occurrenceId : undefined;
    if (!occ) return;
    setBusy(true);
    const idem = crypto.randomUUID();
    let holdId = '';
    let expiresAt = '';
    try {
      const res = await fetch('/api/v1/holds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          occurrenceId: occ,
          expectedSlug: activity.slug,
          people: participants,
          idempotencyKey: idem,
        }),
      }).then((r) => r.json());
      if (res.ok) {
        holdId = res.data.holdId as string;
        expiresAt = res.data.expiresAt as string;
      }
    } catch {
      /* fall through — checkout creates the hold at pay if this failed */
    }
    // Keep the hold tokens OUT of the URL (they'd leak via Referer / history / a shared checkout
    // link); hand them to checkout via sessionStorage keyed by the occurrence instead.
    try {
      window.sessionStorage.setItem(`gytm:hold:${occ}`, JSON.stringify({ holdId, expiresAt, idem }));
    } catch {
      /* sessionStorage unavailable — checkout will create the hold at pay */
    }
    const dateText = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const q = new URLSearchParams({
      occ,
      label: priceLabel,
      qty: String(participants),
      slug: activity.slug,
      title: activity.title,
      lang,
      total: total != null ? String(total) : '',
      when: dateText,
      guests: String(participants),
      unit: unitLabel,
      suv: suvActive ? '1' : '0',
      childSeats: String(childSeats),
      from: 'widget',
    });
    router.push(`/checkout?${q.toString()}`);
  }

  const value: BookingState = {
    activity,
    participants,
    setParticipants,
    date,
    setDate,
    lang,
    setLang,
    suv,
    setSuv,
    childSeats,
    setChildSeats,
    childSeatsExtra,
    days,
    checked,
    setChecked,
    checkAvailability,
    scrollTick,
    bookingOptionId,
    vehicleCfg,
    groupSize,
    seatsLeft,
    maxParticipants,
    unitLabel,
    total,
    unitPriceEur,
    vehicleName,
    priceLabel,
    busy,
    updating,
    touch,
    continueToCheckout,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
