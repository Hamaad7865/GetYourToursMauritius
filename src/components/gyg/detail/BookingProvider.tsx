'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TourType } from '@/lib/validation/common';
import type { PricingMode, TourOption, VehiclePricing } from '@/lib/validation/tours';
import { sightseeingQuote, SIGHTSEEING_DEFAULT } from '@/lib/services/pricing';

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
  days: Map<string, DayInfo> | null;
  checked: boolean;
  setChecked: (b: boolean) => void;
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
  vehicleName: string | null;
  busy: boolean;
  /** Continue: reserve the spot, then route to checkout. */
  continueToCheckout: () => Promise<void>;
}

const Ctx = createContext<BookingState | null>(null);
export const useBooking = (): BookingState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBooking must be used within BookingProvider');
  return v;
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
  const [checked, setChecked] = useState(false);
  const [days, setDays] = useState<Map<string, DayInfo> | null>(null);
  const [busy, setBusy] = useState(false);

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
    fetch(`/api/v1/activities/${activity.slug}/availability?from=${dateKey(today)}&to=${dateKey(horizon)}`)
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
            map.set(dateKey(new Date(s.startsAt)), { occurrenceId: s.occurrenceId, seatsLeft: s.seatsLeft });
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
  const unitLabel = isVehicle ? 'per vehicle' : groupSize ? `per group up to ${groupSize}` : 'per person';
  const suvActive = isVehicle && suv && participants <= vehicleCfg.blockSize;
  const vehicleQuote = isVehicle
    ? sightseeingQuote(Math.min(Math.max(participants, 1), vehicleCfg.maxParty), suvActive, vehicleCfg)
    : null;
  const total = isVehicle
    ? (vehicleQuote?.totalEur ?? null)
    : cheapest == null
      ? null
      : groupSize
        ? cheapest.amountEur * Math.ceil(participants / groupSize)
        : cheapest.amountEur * participants;
  const vehicleName = vehicleQuote?.vehicle ?? null;

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
    const label = isVehicle ? (vehicleQuote?.vehicle ?? 'Vehicle') : (cheapest?.label ?? '');
    const dateText = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const q = new URLSearchParams({
      occ,
      label,
      qty: String(participants),
      slug: activity.slug,
      title: activity.title,
      lang,
      total: total != null ? String(total) : '',
      when: dateText,
      guests: String(participants),
      unit: isVehicle ? 'per vehicle' : groupSize ? `per group up to ${groupSize}` : 'per person',
      suv: suvActive ? '1' : '0',
      from: 'widget',
      idem,
      holdId,
      expiresAt,
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
    days,
    checked,
    setChecked,
    bookingOptionId,
    vehicleCfg,
    groupSize,
    seatsLeft,
    maxParticipants,
    unitLabel,
    total,
    vehicleName,
    busy,
    continueToCheckout,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
