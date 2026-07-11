'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TourType } from '@/lib/validation/common';
import type {
  PricingMode,
  TourOption,
  VehiclePricing,
  TransportBands,
  RegionDistances,
} from '@/lib/validation/tours';
import {
  sightseeingQuote,
  childSeatsCost,
  quoteTotal,
  privateQuote,
  SIGHTSEEING_DEFAULT,
  SIGHTSEEING_SUV_MAX,
} from '@/lib/services/pricing';
import { nominalDayKey, utcDayKey } from '@/lib/services/day-key';
import { defaultOptionId, cheapestTier, privateConfig, type PrivateConfig } from '@/lib/catalogue/options';
import { useToast } from '@/components/site/ToastProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { encodeParty, partyGuests } from '@/lib/services/party';

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
  /** Adults-only activity (e.g. hiking) — hides the baby/child-seats add-on + drives the "18+" quick-fact. */
  adultsOnly: boolean;
  /** Free-cancellation policy text, if the activity offers one (drives the card's reassurance strip). */
  cancellationPolicy: string | null;
  /** Minimum advance booking (lead time) in days — the earliest bookable day is today + this. */
  minAdvanceDays: number;
  image: string | null;
  /** Home/boarding region + coords for the region-based transport add-on. */
  region: string | null;
  lat: number | null;
  lng: number | null;
  /** Global transport fare tables (per_person / per_group with pickup only; null otherwise). */
  transportBands: TransportBands | null;
  regionDistances: RegionDistances | null;
}

/** Pickup/drop-off point captured in the widget (coords drive the transport fare; text is for records). */
export interface PickupPoint {
  address: string;
  lat: number;
  lng: number;
}

interface DayInfo {
  occurrenceId: string;
  seatsLeft: number;
}

interface BookingState {
  activity: BookingActivity;
  participants: number;
  setParticipants: (n: number) => void;
  /** True when the selected option is age-band priced (per_person with ≥2 age tiers) — the widget shows
   *  one stepper per band (Adult / Child / Infant) instead of a single participants count. */
  isAgeBanded: boolean;
  /** The selected option's private-trip config (flat base + per-extra-head, own trips/day pool), or
   *  null for a normal option. When set: one party stepper, seatsLeft counts TRIPS (never people),
   *  and the whole party rides ONE capacity unit. */
  privateCfg: PrivateConfig | null;
  /** The price tiers to render as age bands (the selected option's tiers) when isAgeBanded. */
  bandTiers: TourOption['prices'];
  /** Per-band head counts (age-banded mode). */
  bandCounts: Record<string, number>;
  /** Set one band's count (clamped to capacity + the band's own max_guests). */
  setBand: (label: string, n: number) => void;
  /** Total headcount: participants (single) or the sum of the band counts (age-banded). */
  totalGuests: number;
  /** Price-tier → count map posted to the server (age-banded bands, else { priceLabel: qty }). */
  party: Record<string, number>;
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
  /** The currently selected option's id (drives price + availability), or null. */
  selectedOptionId: string | null;
  /** The currently selected option object, or null when the activity has no options. */
  selectedOption: TourOption | null;
  /** Select a different option: re-prices, re-fetches availability, and clears the date pick. */
  setSelectedOption: (id: string) => void;
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
  const { showToast } = useToast();
  const t = useT();
  // Resolve the option the widget opens on up-front, so the initial party can default to a private
  // option's covered count (`included`) with no flash from the generic default of 2.
  const initialOptionId = defaultOptionId(activity.options, activity.pricingMode === 'vehicle');
  const initialOption = activity.options.find((o) => o.id === initialOptionId) ?? activity.options[0] ?? null;
  const initialPrivate = initialOption ? privateConfig(initialOption) : null;
  const [participants, setParticipants] = useState(initialPrivate ? initialPrivate.included : 2);
  const [bandCounts, setBandCounts] = useState<Record<string, number>>({});
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

  // The SELECTED option drives price + availability. Defaults to today's behaviour: options[0] for
  // vehicle mode, else the option holding the globally cheapest tier (matching the old `cheapest` scan).
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(initialOptionId);
  const selectedOption = useMemo(
    () => activity.options.find((o) => o.id === selectedOptionId) ?? activity.options[0] ?? null,
    [activity.options, selectedOptionId],
  );
  const setSelectedOption = useCallback((id: string) => {
    setSelectedOptionId(id);
    setDate(''); // occurrences differ per option — force a fresh date pick
    touch();
  }, [touch]);

  // The selected option's cheapest tier drives the per-person/per-group price (and tier caps).
  const selectedTier = useMemo(
    () => (selectedOption ? cheapestTier(selectedOption) : null),
    [selectedOption],
  );
  const bookingOptionId = selectedOption?.id ?? null;

  // Private option: flat base covers the first `included` guests, `extraEur` per additional head; the
  // pool counts TRIPS/day (a booking consumes ONE unit, any group size — the server coerces the hold).
  const privateCfg = useMemo(
    () => (selectedOption ? privateConfig(selectedOption) : null),
    [selectedOption],
  );

  // Switching TO a private option resets the party to what the base price covers (`included`) — the
  // natural starting point. Keyed on privateCfg identity (stable per option), so a manual change within
  // the same option sticks; redundant on first mount where the initial state already set it.
  useEffect(() => {
    if (privateCfg) setParticipants(privateCfg.included);
  }, [privateCfg]);

  // Age-band pricing: a per_person option with ≥2 tiers carrying age metadata is shown as a
  // GetYourGuide-style set of per-band steppers (Adult / Child / Infant), each priced from its OWN DB
  // tier. The server re-derives the total from the posted band map (zero-trust) — see api_book.
  const bandTiers = useMemo(() => selectedOption?.prices ?? [], [selectedOption]);
  const isAgeBanded =
    activity.pricingMode === 'per_person' &&
    bandTiers.length >= 2 &&
    bandTiers.some((t) => t.minAge != null || t.maxAge != null);
  // The full-price band (highest €) is the "adult" — it seeds the default count and the price label.
  const primaryLabel = useMemo(() => {
    if (!bandTiers.length) return null;
    return bandTiers.reduce((a, b) => (b.amountEur > a.amountEur ? b : a)).label;
  }, [bandTiers]);
  // Reset the band counts to one primary (adult) guest whenever the option (its tiers) changes.
  useEffect(() => {
    if (isAgeBanded && primaryLabel) setBandCounts({ [primaryLabel]: 1 });
    else setBandCounts({});
  }, [selectedOptionId, isAgeBanded, primaryLabel]);
  const totalGuests = isAgeBanded ? partyGuests(bandCounts) : participants;

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

  const groupSize = activity.pricingMode === 'per_group' ? (selectedTier?.maxGuests ?? null) : null;
  const seatsLeft = (date ? days?.get(date)?.seatsLeft : undefined) ?? 0;
  const tierCap = activity.pricingMode === 'per_person' && selectedTier?.maxGuests ? selectedTier.maxGuests : Infinity;
  // A private party is capped by its own max group size ONLY — seatsLeft counts trips, not people,
  // so a 1-trip day must still accept a party of 6.
  const maxParticipants = privateCfg
    ? Math.max(1, privateCfg.maxGuests)
    : isVehicle
      ? Math.max(1, vehicleCfg.maxParty)
      : Math.max(1, Math.min(16, tierCap, date ? seatsLeft : 16));
  const unitLabel = privateCfg
    ? 'per private trip'
    : isVehicle
      ? 'per vehicle'
      : groupSize
        ? `per group up to ${groupSize}`
        : activity.type === 'transport'
          ? 'per vehicle'
          : 'per person';
  const suvActive = isVehicle && suv && participants <= SIGHTSEEING_SUV_MAX;

  const setBand = useCallback(
    (lbl: string, n: number) => {
      setBandCounts((cur) => {
        const tier = bandTiers.find((t) => t.label === lbl);
        const wanted = Math.max(0, Math.round(n));
        if (lbl === primaryLabel && wanted < 1) return cur; // always keep ≥1 adult (no €0 / infant-only)
        const next = { ...cur, [lbl]: wanted };
        if (tier?.maxGuests && wanted > tier.maxGuests) return cur;
        if (partyGuests(next) > maxParticipants) return cur; // never exceed the seat cap
        return next;
      });
      touch();
    },
    [bandTiers, maxParticipants, primaryLabel, touch],
  );

  // Clamp the party down when the cap drops (e.g. switching to a date with fewer seats), so an
  // over-capacity selection never reaches Check availability / checkout.
  useEffect(() => {
    if (!isAgeBanded && participants > maxParticipants) {
      // Seat-driven shrink (a date with fewer seats): tell the customer — a silently changed party
      // re-quotes a different price with no explanation. Tier-driven caps (option switch) stay silent.
      if (date && seatsLeft < participants) {
        showToast({
          title: t('Party size reduced'),
          description: t('Only {n} {noun} left on this date.', {
            n: maxParticipants,
            noun: maxParticipants === 1 ? t('spot') : t('spots'),
          }),
        });
      }
      setParticipants(maxParticipants);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgeBanded, participants, maxParticipants]);
  // Age-banded equivalent: trim extra band guests (keeping ≥1 primary) if the seat cap drops below the total.
  useEffect(() => {
    if (!isAgeBanded || partyGuests(bandCounts) <= maxParticipants) return;
    if (date && seatsLeft < partyGuests(bandCounts)) {
      showToast({
        title: t('Party size reduced'),
        description: t('Only {n} {noun} left on this date.', {
          n: maxParticipants,
          noun: maxParticipants === 1 ? t('spot') : t('spots'),
        }),
      });
    }
    setBandCounts((cur) => {
      let over = partyGuests(cur) - maxParticipants;
      const next = { ...cur };
      for (const lbl of Object.keys(next)) {
        if (over <= 0) break;
        if (lbl === primaryLabel) continue;
        const take = Math.min(next[lbl] ?? 0, over);
        next[lbl] = (next[lbl] ?? 0) - take;
        over -= take;
      }
      if (over > 0 && primaryLabel) next[primaryLabel] = Math.max(1, (next[primaryLabel] ?? 1) - over);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgeBanded, bandCounts, maxParticipants, primaryLabel]);
  // Reset the SUV upgrade once the party grows past the entry tier, so dropping back to ≤ 4 starts
  // from Sedan instead of silently snapping the price back to the SUV rate. Applies to both the
  // sightseeing vehicle and the per-person transport add-on (which share the `suv` flag).
  useEffect(() => {
    if (suv && participants > SIGHTSEEING_SUV_MAX) setSuv(false);
  }, [suv, participants]);
  // Can't request more child seats than passengers (total headcount, incl. every age band).
  useEffect(() => {
    if (childSeats > totalGuests) setChildSeats(totalGuests);
  }, [childSeats, totalGuests]);
  const vehicleQuote = isVehicle
    ? sightseeingQuote(Math.min(Math.max(participants, 1), vehicleCfg.maxParty), suvActive, vehicleCfg)
    : null;
  // Age-banded: sum each band's count × its own DB price (infant €0 still counts a head). Wrapped so an
  // over-cap transient never throws into render — falls back to null (Continue stays disabled).
  const bandQuote = useMemo(() => {
    if (!isAgeBanded || totalGuests < 1) return null;
    try {
      return quoteTotal(
        bandTiers.map((t) => ({ label: t.label, amountEur: t.amountEur, maxGuests: t.maxGuests })),
        bandCounts,
      );
    } catch {
      return null;
    }
  }, [isAgeBanded, bandTiers, bandCounts, totalGuests]);
  // Private: base + per-extra-head, mirroring create_booking's private branch cent-for-cent. Wrapped so
  // an over-cap transient never throws into render — falls back to null (Continue stays disabled).
  const privateTotal = useMemo(() => {
    if (!privateCfg || participants < 1) return null;
    try {
      return privateQuote(privateCfg.baseEur, privateCfg.included, privateCfg.extraEur, participants, privateCfg.maxGuests);
    } catch {
      return null;
    }
  }, [privateCfg, participants]);
  const baseTotal = privateCfg
    ? privateTotal
    : isVehicle
      ? (vehicleQuote?.totalEur ?? null)
      : isAgeBanded
        ? (bandQuote?.totalEur ?? null)
        : selectedTier == null
          ? null
          : activity.pricingMode === 'per_group'
            ? // One flat price per group of `groupSize`. If the group size is missing (a per_group tier
              // saved without a cap), the server prices PER HEAD — so fall back to per head here too, so
              // Continue, the cart line and the actual charge all agree (never a single under-stated group).
              groupSize
              ? selectedTier.amountEur * Math.ceil(participants / groupSize)
              : selectedTier.amountEur * participants
            : selectedTier.amountEur * participants;
  const childSeatsExtra = childSeatsCost(childSeats);

  // Region-based transport is no longer chosen here — pickup + the distance-based transport fee are
  // confirmed in the CHECKOUT flow (one global place, for every pricing mode). The activity page shows
  // the base price only; `pickupcap` (below) seeds checkout's "want pickup?" default.
  const total = baseTotal == null ? null : baseTotal + childSeatsExtra;
  // Per-unit price for the cart: a vehicle is one flat unit (its whole price); per-group / per-person
  // is the tier's unit price (the cart multiplies it by the party). Never includes the child add-on.
  // Age-banded lines carry the WHOLE party price as a flat unit (like vehicle mode) since there's no single
  // per-head number; the cart treats a line with a `party` map as flat (see itemTotal).
  const unitPriceEur =
    isVehicle || isAgeBanded || privateCfg ? (baseTotal ?? 0) : (selectedTier?.amountEur ?? 0);
  const vehicleName = vehicleQuote?.vehicle ?? null;
  // Single source of the price-tier label for BOTH Continue and Add-to-cart. They used to diverge:
  // Add-to-cart hardcoded 'Adult', which the server rejects (unknown_price_tier) for any tour whose
  // cheapest tier isn't labelled 'Adult'. A private option has NO tiers — the server prices from the
  // option's own config and ignores the label (it writes the option name on the line item), so the
  // option name is used here purely for display.
  const priceLabel = privateCfg
    ? (selectedOption?.name ?? 'Private')
    : isVehicle
      ? (vehicleName ?? 'Vehicle')
      : isAgeBanded
        ? (primaryLabel ?? selectedTier?.label ?? '')
        : (selectedTier?.label ?? '');
  // The price-tier → count map posted to the server. Age-banded: the chosen bands; else the single tier
  // (for a private option the map carries the HEADCOUNT — the server prices base + per-extra-head from it).
  const party: Record<string, number> = isAgeBanded
    ? Object.fromEntries(Object.entries(bandCounts).filter(([, n]) => n > 0))
    : priceLabel
      ? { [priceLabel]: participants }
      : {};

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
          people: totalGuests,
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
    // Mirror this Book-now reservation into the cart as an on-hold line (same shape as Add-to-cart),
    // keyed by occurrence, so leaving checkout doesn't hide the held spot. Checkout reads this on mount
    // and upserts it with the hold details; the cart's timer + reconcile + expiry bell own it after.
    // (A cart proceed already has its line, so it never stashes one here.) idemKey = the hold's idem so
    // checkout + pay reuse the one hold.
    try {
      window.sessionStorage.setItem(
        `gytm:cartline:${occ}`,
        JSON.stringify({
          id: `${occ}:${vehicleName ?? 'tour'}`,
          slug: activity.slug,
          title: activity.title,
          image: activity.image,
          occurrenceId: occ,
          dateLabel: dateText,
          lang,
          priceLabel,
          guests: totalGuests,
          unitEur: unitPriceEur,
          pricingMode: activity.pricingMode,
          // A party map marks the line's unitEur as the WHOLE flat price (see itemTotal): the age bands,
          // or the private trip (whose base+extras total never re-multiplies by the guest count).
          party: isAgeBanded || privateCfg ? party : undefined,
          suv: suvActive,
          childSeats,
          maxGuests: groupSize,
          seatsLeft,
          unit: unitLabel,
          idemKey: idem,
        }),
      );
    } catch {
      /* sessionStorage unavailable — the on-hold cart line just won't appear; checkout still works */
    }
    const q = new URLSearchParams({
      occ,
      label: priceLabel,
      qty: String(totalGuests),
      // Age-banded: the full per-band map so the server prices each band; `label`/`qty` stay for the
      // single-tier back-compat path + display. Empty for a normal single-tier booking.
      party: isAgeBanded ? encodeParty(party) : '',
      slug: activity.slug,
      title: activity.title,
      lang,
      total: total != null ? String(total) : '',
      when: dateText,
      guests: String(totalGuests),
      unit: unitLabel,
      suv: suvActive ? '1' : '0',
      childSeats: String(activity.adultsOnly ? 0 : childSeats),
      // Pickup CAPABILITY: seeds checkout step ①'s "want pickup?" default to Yes for a pickup-capable
      // (per_person/per_group with pickup) activity. The pickup itself + the transport fee are chosen
      // and priced AT CHECKOUT now, not here.
      pickupcap:
        (activity.pricingMode === 'per_person' || activity.pricingMode === 'per_group') && activity.pickupAvailable
          ? '1'
          : '',
      from: 'widget',
    });
    router.push(`/checkout?${q.toString()}`);
  }

  const value: BookingState = {
    activity,
    participants,
    setParticipants,
    isAgeBanded,
    privateCfg,
    bandTiers,
    bandCounts,
    setBand,
    totalGuests,
    party,
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
    selectedOptionId,
    selectedOption,
    setSelectedOption,
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
