'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlannerData } from './usePlannerData';
import { HeroSection } from './HeroSection';
import { ItineraryPanel } from './ItineraryPanel';
import { ChatCopilot } from './ChatCopilot';
import { PlacesDrawer } from './PlacesDrawer';
import { QuoteModal } from './QuoteModal';
import { AIInsights } from './AIInsights';
import { DayTabs } from './DayTabs';
import { ActivityCard } from './ActivityCard';
import { RouteMap, type ActivityMarker, type StopKind } from '@/components/maps/RouteMap';
import { PresetsSection, type PresetCard } from './PresetsSection';
import { FeaturesSection } from './FeaturesSection';
import { TrustSection } from './TrustSection';
import { FaqSection } from './FaqSection';
import { PICKUPS, PRESETS, fmtDur, type PlannerPoint } from './planner-constants';
import { computePlannerRoute } from '@/lib/planner/route';
import { plannerQuote, type PlannerQuote } from '@/lib/planner/pricing';
import { addBlockReason, dayRegionLabel, MAX_STOPS } from '@/lib/planner/constraints';
import {
  childSeatsCost,
  regionDistanceBand,
  REGION_DISTANCE_DEFAULT,
} from '@/lib/services/pricing';
import { stopsToParam } from '@/lib/planner/share';
import { parseTripParams, tripDates, tripToParams, type TripDayPlan } from '@/lib/planner/trip';
import type { BmtActivity, BmtCandidate } from '@/lib/planner/our-activities';
import { nominalDayKey, utcDayKey } from '@/lib/services/day-key';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { ChatMsg, Boost } from './types';
import { useMoney, useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';

const CUSTOM_SLUG = 'custom-road-trip';
const CUSTOM_TITLE = 'Custom Road Trip';

/** Belle Mare Tours activity info the shell keeps per slug — the catalogue data plus, when it came
 *  from an availability-checked recommendation, the real seats left on its date. */
type BmtInfo = BmtActivity & { seatsLeft?: number };

/** "Tue 2 Sep" style label for a trip day. */
function dayDateLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? dayKey
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * AI Road Trip Planner — the design experience wired to LIVE Google Places. Places are no longer
 * seeded: the drawer + co-pilot discover them from Google, and every place we encounter (browsed,
 * AI-chosen, preset, deep-linked) is kept in a `catalog` so the map/itinerary can resolve any stop.
 * `stopIds` + `pickup` are the source of truth; route, drive times, price + the share URL derive from
 * them. The co-pilot is the real grounded agent; the map is the real Google map with a red car;
 * "Get my quote" runs the live availability → hold → /checkout booking.
 */
export function PlannerShell() {
  const router = useRouter();
  const t = useT();
  const money = useMoney();
  const { pricing } = usePlannerData();

  const [catalog, setCatalog] = useState<Map<string, PlannerPlace>>(new Map());
  const [heroValue, setHeroValue] = useState('');
  const [pickup, setPickup] = useState<PlannerPoint>(PICKUPS[0]!);
  const [dropoff, setDropoff] = useState<PlannerPoint | null>(null);
  // Whether the customer wants a distinct drop-off. Owned here (not in ItineraryPanel) so the toggle
  // survives the mobile tab remount and a "clear trip", and stays consistent with `dropoff`.
  const [wantsDropoff, setWantsDropoff] = useState(false);
  const [stopIds, setStopIds] = useState<string[]>([]);
  // ── trip (range) mode: `days` non-null = multi-day planning; null = the classic single-day flow.
  //    The active day drives the itinerary panel, chat context, map and booking together. ──
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [days, setDays] = useState<TripDayPlan[] | null>(null);
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  // Belle Mare Tours activities the shell knows (recommendations + the browse layer), by slug.
  const [bmtCatalog, setBmtCatalog] = useState<Map<string, BmtInfo>>(new Map());
  const [bmtAll, setBmtAll] = useState<BmtActivity[] | null>(null);
  const [showBmtLayer, setShowBmtLayer] = useState(false);
  // A branded marker was clicked — the activity pop-over on the map pane.
  const [openBmt, setOpenBmt] = useState<{ slug: string; date: string } | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState(false);
  const [hasBuilt, setHasBuilt] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [party, setParty] = useState(2);
  const [suv, setSuv] = useState(false);
  const [childSeats, setChildSeats] = useState(0);
  const [date, setDate] = useState('');
  const [minDate, setMinDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [boost, setBoost] = useState<Boost | null>(null);
  const [bannerTour, setBannerTour] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'day' | 'map'>('chat');
  const [shared, setShared] = useState(false);
  const initRef = useRef(false);
  const lastOptimizedKey = useRef('');

  const addToCatalog = useCallback((ps: PlannerPlace[]) => {
    if (!ps.length) return;
    setCatalog((prev) => {
      const next = new Map(prev);
      for (const p of ps) next.set(p.id, p);
      return next;
    });
  }, []);

  // ── derived ──
  const isTrip = days !== null && days.length > 0;
  const activeDay = isTrip ? (days[Math.min(activeDayIdx, days.length - 1)] ?? null) : null;
  // The stop ids the whole page works on: the active trip day's, or the classic single day's.
  const activeStopIds = activeDay ? activeDay.stopIds : stopIds;
  /** Apply a stop-list update to one specific day (by date) or, `null`, to the single-day list.
   *  Targeted by DATE — not "the active day at set time" — so an async result (e.g. the route
   *  optimizer) can never land on a day the visitor has since switched away from. */
  const applyStops = useCallback((target: string | null, updater: (prev: string[]) => string[]) => {
    if (target === null) {
      setStopIds(updater);
    } else {
      setDays((prev) =>
        prev
          ? prev.map((d) => (d.date === target ? { ...d, stopIds: updater(d.stopIds) } : d))
          : prev,
      );
    }
  }, []);
  const activeDate = activeDay?.date ?? null;
  const setActiveStopIds = useCallback(
    (updater: (prev: string[]) => string[]) => applyStops(activeDate, updater),
    [applyStops, activeDate],
  );

  const stops = useMemo(
    () => activeStopIds.map((id) => catalog.get(id)).filter((p): p is PlannerPlace => Boolean(p)),
    [activeStopIds, catalog],
  );
  const stopIndex = useMemo(() => new Map(stops.map((p, i) => [p.id, i])), [stops]);
  // Region guardrail inputs: the regions currently in the day, and whether the day is at the 6-stop cap.
  const dayRegions = useMemo(() => stops.map((s) => s.region), [stops]);
  const dayFull = stops.length >= MAX_STOPS;
  const blockedMessage = useCallback(
    (reason: 'full' | 'far-region', name: string) => {
      const region = dayRegionLabel(dayRegions);
      return reason === 'full'
        ? t('Your day is full at {max} stops — remove one to add {name}.', { max: MAX_STOPS, name })
        : t(
            '{name} is too far from your {region} day — that would be a separate trip. Try somewhere closer.',
            {
              name,
              region: region ?? t('current'),
            },
          );
    },
    [dayRegions, t],
  );
  // The day ends back at the pickup unless the customer chose a distinct drop-off (one-way).
  const dropoffDiffers = !!dropoff && dropoff.id !== pickup.id;
  const route = useMemo(
    () =>
      computePlannerRoute(
        pickup,
        stops.map((s) => ({ lat: s.lat, lng: s.lng, durationMin: s.durationMin })),
        dropoff && dropoff.id !== pickup.id ? dropoff : pickup,
      ),
    [pickup, stops, dropoff],
  );
  // Identifies a day by its *unordered* set of stops + pickup. Auto-optimization reorders the day to
  // the shortest round trip whenever this key changes (a stop added/removed, or the pickup changed);
  // since reordering leaves the key unchanged, the optimizer never re-triggers itself (no loop), and a
  // manual drag-reorder stands until the next change.
  const optimizeKey = useMemo(
    () => `${activeDate ?? ''}|${pickup.id}|${[...activeStopIds].sort().join(',')}`,
    [activeDate, pickup, activeStopIds],
  );

  let quote: PlannerQuote | null = null;
  let quoteError: string | null = null;
  try {
    quote = plannerQuote(party, suv, pricing);
  } catch {
    quoteError = t('Groups over {max} — contact us', { max: pricing.maxParty });
  }

  const presetCards = useMemo<PresetCard[]>(
    () =>
      PRESETS.map((p) => {
        const r = computePlannerRoute(
          pickup,
          p.places.map((x) => ({ lat: x.lat, lng: x.lng, durationMin: x.durationMin })),
        );
        return {
          id: p.id,
          name: p.name,
          grad: p.grad,
          stopCount: p.places.length,
          hoursLabel: `~${Math.max(1, Math.round((r.totalMinutes + r.visitMinutes) / 60))}h`,
          fromEur: pricing.standardEur,
        };
      }),
    [pickup, pricing.standardEur],
  );

  // ── opening-hours boost ──
  useEffect(() => {
    if (stops.length < 3) {
      setBoost(null);
      return;
    }
    let found: Boost | null = null;
    stops.forEach((p, idx) => {
      if (p.closesAt && idx >= 2 && (!found || p.closesAt < found.close)) {
        found = { place: p.name, close: p.closesAt, id: p.id };
      }
    });
    setBoost(found);
  }, [stops]);

  // ── auto-optimize: reorder the day to the shortest driving round trip (pickup → stops → pickup)
  //    via the Google Route Optimization API, debounced, whenever the stop set or pickup changes.
  //    Best-effort + race-guarded: a stale/failed response or a newer change is ignored, and the
  //    planner keeps its current order when optimization is unavailable. ──
  useEffect(() => {
    if (stops.length < 2) {
      lastOptimizedKey.current = optimizeKey;
      return;
    }
    if (optimizeKey === lastOptimizedKey.current) return;

    let active = true;
    // The day this optimization run belongs to, captured NOW — a slow response can never reorder a
    // different day the visitor switched to meanwhile.
    const targetDate = activeDate;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/planner/optimize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pickup: { lat: pickup.lat, lng: pickup.lng },
            stops: stops.map((s) => ({ lat: s.lat, lng: s.lng })),
          }),
        }).then((r) => r.json());
        if (!active) return;
        lastOptimizedKey.current = optimizeKey;
        const order: unknown = res.ok ? res.data?.order : null;
        if (Array.isArray(order) && order.length === stops.length) {
          const reordered = order
            .map((i) => stops[i as number]?.id)
            .filter((id): id is string => Boolean(id));
          const current = stops.map((s) => s.id);
          if (reordered.length === current.length && reordered.join(',') !== current.join(',')) {
            applyStops(targetDate, () => reordered);
          }
        }
      } catch {
        if (active) lastOptimizedKey.current = optimizeKey;
      }
    }, 700);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [optimizeKey, stops, pickup, activeDate, applyStops]);

  // ── mount: responsive + dates ──
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 920px)');
    const upd = () => setIsMobile(mq.matches);
    upd();
    mq.addEventListener('change', upd);
    // Earliest bookable day is TOMORROW (we don't fulfil same-day) — the server rejects today too.
    const tomorrow = new Date(Date.now() + 86_400_000);
    setMinDate(nominalDayKey(tomorrow));
    setDate(nominalDayKey(tomorrow));
    return () => mq.removeEventListener('change', upd);
  }, []);

  // ── mount: deep-link. `?fromTour=slug` hands a sightseeing tour's itinerary to the planner (stops
  //    resolved server-side); `?stops=placeId,placeId&tour=Name` is the shareable form. ──
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const params = new URLSearchParams(window.location.search);

    // A shared TRIP link (?from&to&dN…) restores the whole multi-day plan and wins over the
    // single-day deep-links below.
    const tripPlan = parseTripParams(params, MAX_STOPS);
    if (tripPlan) {
      setDays(tripPlan);
      setRangeFrom(tripPlan[0]!.date);
      setRangeTo(tripPlan[tripPlan.length - 1]!.date);
      setActiveDayIdx(0);
      const anyPlanned = tripPlan.some((d) => d.stopIds.length || d.activitySlug);
      if (anyPlanned) setHasBuilt(true);
      const ids = [
        ...new Set(tripPlan.flatMap((d) => [...d.stopIds, ...(d.dinnerId ? [d.dinnerId] : [])])),
      ];
      if (ids.length) {
        (async () => {
          try {
            const res = await fetch(
              `/api/planner/places?ids=${encodeURIComponent(ids.join(','))}`,
            ).then((r) => r.json());
            const places: PlannerPlace[] = res.ok ? res.data : [];
            if (places.length) addToCatalog(places);
          } catch {
            /* unresolved ids just drop from the restored trip */
          }
        })();
      }
      if (tripPlan.some((d) => d.activitySlug)) {
        // Anchored activity cards need catalogue data — load the (cached) BMT list once.
        (async () => {
          try {
            const res = await fetch('/api/planner/our-activities').then((r) => r.json());
            const list: BmtActivity[] = res.ok ? res.data : [];
            setBmtAll(list);
            setBmtCatalog((prev) => {
              const next = new Map(prev);
              for (const a of list) if (!next.has(a.slug)) next.set(a.slug, a);
              return next;
            });
          } catch {
            /* cards degrade to nothing; markers just don't show */
          }
        })();
      }
      return;
    }

    const fromTour = params.get('fromTour');
    if (fromTour) {
      (async () => {
        try {
          const res = await fetch(
            `/api/planner/from-tour?slug=${encodeURIComponent(fromTour)}`,
          ).then((r) => r.json());
          const tourName: string | null = res.ok ? (res.data?.tour ?? null) : null;
          const places: PlannerPlace[] =
            res.ok && Array.isArray(res.data?.places) ? res.data.places : [];
          if (tourName) setBannerTour(tourName.slice(0, 80));
          if (places.length) {
            addToCatalog(places);
            setStopIds(places.map((p) => p.id));
            setHasBuilt(true);
            setChat([
              {
                role: 'assistant',
                kind: 'text',
                text: t(
                  "You're customizing {tour} — I've loaded its stops. Add, drop or reorder anything and I'll keep the route and price live.",
                  { tour: tourName ?? t('this tour') },
                ),
              },
            ]);
          } else {
            setChat([
              {
                role: 'assistant',
                kind: 'text',
                text: t(
                  "Let's build on {tour}. Tell me what you'd like to see, or browse places and I'll shape the day around them.",
                  { tour: tourName ?? t('this tour') },
                ),
              },
            ]);
          }
        } catch {
          /* tour resolution failed — start from an empty day */
        }
      })();
      return;
    }

    const raw = (params.get('stops') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const tour = params.get('tour');
    if (tour) setBannerTour(tour.slice(0, 80));
    if (raw.length) {
      (async () => {
        try {
          const res = await fetch(
            `/api/planner/places?ids=${encodeURIComponent(raw.join(','))}`,
          ).then((r) => r.json());
          const places: PlannerPlace[] = res.ok ? res.data : [];
          if (places.length) {
            addToCatalog(places);
            setStopIds(places.map((p) => p.id));
            setHasBuilt(true);
            if (tour) {
              setChat([
                {
                  role: 'assistant',
                  kind: 'text',
                  text: t(
                    "You're customizing the {tour} — I've loaded its stops. Add, drop or reorder anything and I'll keep the route and price live.",
                    { tour: tour.slice(0, 80) },
                  ),
                },
              ]);
            }
          }
        } catch {
          /* deep-link resolution failed — start empty */
        }
      })();
    }
    // `t` only seeds the initial chat copy; the initRef guard makes a re-run (e.g. on language change)
    // a no-op, so listing it satisfies exhaustive-deps without re-resolving the deep link.
  }, [addToCatalog, t]);

  // ── shareable URL ──
  useEffect(() => {
    if (!initRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    // The tour hand-off is a one-shot trigger; drop it so the URL settles into the shareable form.
    params.delete('fromTour');
    if (days !== null) {
      // Trip mode: the multi-day form replaces ?stops= entirely.
      params.delete('stops');
      tripToParams(params, days);
    } else {
      tripToParams(params, []); // clears from/to + any dN leftovers after exiting trip mode
      if (stopIds.length) params.set('stops', stopsToParam(stopIds));
      else params.delete('stops');
    }
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }, [stopIds, days]);

  // ── trip range entry/exit ──
  /** Reconcile the trip state with a (possibly partial) From/To pick. Both dates + a >1-day span ⇒
   *  trip mode (existing days kept by date; the current single day seeds day 1). Anything else ⇒
   *  single-day mode, keeping the active day's stops so no work is ever lost. */
  const applyRange = useCallback(
    (from: string, to: string) => {
      setRangeFrom(from);
      setRangeTo(to);
      const dates = from && to ? tripDates(from, to) : [];
      if (dates.length > 1) {
        setDays((prev) => {
          const prevByDate = new Map((prev ?? []).map((d) => [d.date, d]));
          return dates.map((date, i) => {
            const kept = prevByDate.get(date);
            if (kept) return kept;
            // Entering trip mode with a day already built: it becomes Day 1.
            const seed = prev === null && i === 0 ? stopIds : [];
            return { date, stopIds: seed, dinnerId: null, activitySlug: null };
          });
        });
        setActiveDayIdx(0);
      } else {
        if (days !== null) setStopIds(activeDay?.stopIds ?? []);
        setDays(null);
        setActiveDayIdx(0);
        // A single picked day still primes the booking date.
        if (dates.length === 1) setDate(dates[0]!);
      }
    },
    [stopIds, days, activeDay],
  );
  /** DayTabs "Single day": leave trip mode, carrying the active day's stops. */
  const exitTrip = useCallback(() => applyRange('', ''), [applyRange]);

  // ── Belle Mare Tours helpers ──
  /** Merge browse-layer data in WITHOUT clobbering richer recommendation entries (seatsLeft). */
  const mergeBmtList = useCallback((list: BmtActivity[]) => {
    setBmtCatalog((prev) => {
      const next = new Map(prev);
      for (const a of list) if (!next.has(a.slug)) next.set(a.slug, a);
      return next;
    });
  }, []);
  /** Recommendations always win — they carry the availability facts. */
  const mergeBmtRecommendations = useCallback((recs: BmtCandidate[]) => {
    if (!recs.length) return;
    setBmtCatalog((prev) => {
      const next = new Map(prev);
      for (const r of recs) next.set(r.slug, r);
      return next;
    });
  }, []);
  const toggleBmtLayer = useCallback(() => {
    setShowBmtLayer((on) => !on);
    if (bmtAll === null) {
      (async () => {
        try {
          const res = await fetch('/api/planner/our-activities').then((r) => r.json());
          const list: BmtActivity[] = res.ok ? res.data : [];
          setBmtAll(list);
          mergeBmtList(list);
        } catch {
          setBmtAll([]); // failed fetch: the toggle just shows nothing extra
        }
      })();
    }
  }, [bmtAll, mergeBmtList]);

  // ── stop ops ──
  // Raw committer (no guards) — used by the guarded user/AI-driven adds below and trusted REPLACE paths.
  const commitStopId = useCallback(
    (id: string) => {
      setActiveStopIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setHasBuilt(true);
    },
    [setActiveStopIds],
  );
  // ChatCopilot "+ Add" on a place card. Guarded by the 6-stop cap + region rule; explains if blocked.
  const addStopId = useCallback(
    (id: string) => {
      const place = catalog.get(id);
      const reason = addBlockReason(place?.region ?? null, dayRegions);
      if (reason) {
        setChat((c) => [
          ...c,
          {
            role: 'assistant',
            kind: 'text',
            text: blockedMessage(reason, place?.name ?? t('that place')),
          },
        ]);
        return;
      }
      commitStopId(id);
    },
    [catalog, dayRegions, blockedMessage, commitStopId, t],
  );
  // PlacesDrawer "+ Add". Same guard, using the place's own region/name.
  const addPlace = useCallback(
    (place: PlannerPlace) => {
      const reason = addBlockReason(place.region, dayRegions);
      if (reason) {
        setChat((c) => [
          ...c,
          { role: 'assistant', kind: 'text', text: blockedMessage(reason, place.name) },
        ]);
        return;
      }
      addToCatalog([place]);
      commitStopId(place.id);
    },
    [addToCatalog, commitStopId, dayRegions, blockedMessage],
  );
  const removeStop = useCallback(
    (id: string) => setActiveStopIds((prev) => prev.filter((x) => x !== id)),
    [setActiveStopIds],
  );
  const moveStop = useCallback(
    (from: number, to: number) => {
      setActiveStopIds((prev) => {
        const a = [...prev];
        const [m] = a.splice(from, 1);
        if (m == null) return prev;
        a.splice(to, 0, m);
        return a;
      });
    },
    [setActiveStopIds],
  );
  const clearTrip = useCallback(() => {
    setStopIds([]);
    setChat([]);
    setBoost(null);
    setHasBuilt(false);
    setTyping(false);
    // "Start over" returns the day to a clean round trip — don't leave a stale drop-off behind.
    setDropoff(null);
    setWantsDropoff(false);
    // …and, in trip mode, drops the whole range back to a fresh single day.
    setDays(null);
    setActiveDayIdx(0);
    setRangeFrom('');
    setRangeTo('');
    setOpenBmt(null);
  }, []);
  /** Un-anchor the recommended activity / dinner from one day (the small × on their cards). */
  const removeDayActivity = useCallback((date: string) => {
    setDays((prev) =>
      prev ? prev.map((d) => (d.date === date ? { ...d, activitySlug: null } : d)) : prev,
    );
  }, []);
  const removeDayDinner = useCallback((date: string) => {
    setDays((prev) =>
      prev ? prev.map((d) => (d.date === date ? { ...d, dinnerId: null } : d)) : prev,
    );
  }, []);
  // Changing the pickup to the current drop-off would leave a contradictory drop-off selected; clear it.
  const choosePickup = useCallback((p: PlannerPoint) => {
    setPickup(p);
    setDropoff((d) => (d && d.id === p.id ? null : d));
  }, []);

  function applyBoost() {
    if (!boost) return;
    setActiveStopIds((prev) => {
      const i = prev.indexOf(boost.id);
      if (i <= 0) return prev;
      const a = [...prev];
      const [m] = a.splice(i, 1);
      a.splice(1, 0, m!);
      return a;
    });
    setChat((c) => [
      ...c,
      {
        role: 'assistant',
        kind: 'text',
        text: t('Done — I moved {place} earlier so you arrive well before it closes.', {
          place: boost.place,
        }),
      },
    ]);
    setBoost(null);
  }

  // ── chat (real grounded agent over live Google Places) ──
  async function sendChat(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const history = chat
      .filter((m): m is Extract<ChatMsg, { kind: 'text' }> => m.kind === 'text')
      .map((m) => ({ role: m.role, content: m.text }));
    setChat((c) => [...c, { role: 'user', kind: 'text', text: trimmed }]);
    setTyping(true);
    setHasBuilt(true);
    // Range mode: the whole trip travels with the turn, so ZilAi keeps/modifies existing days.
    const tripPayload =
      isTrip && days
        ? {
            from: days[0]!.date,
            to: days[days.length - 1]!.date,
            activeDate: activeDay?.date ?? days[0]!.date,
            days: days.map((d) => ({
              date: d.date,
              places: d.stopIds
                .map((id) => catalog.get(id))
                .filter((p): p is PlannerPlace => Boolean(p)),
              dinner: d.dinnerId ? catalog.get(d.dinnerId) : undefined,
              activitySlug: d.activitySlug ?? undefined,
            })),
          }
        : undefined;
    try {
      const res = await fetch('/api/ai/trip-planner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: trimmed }].slice(-12),
          // The current day, so ZilAi keeps/modifies it (e.g. "add a beach") rather than replacing it.
          ...(tripPayload ? { trip: tripPayload } : { itinerary: stops }),
        }),
      }).then((r) => r.json());
      setTyping(false);
      if (res.ok) {
        const reply: string = res.data.reply;
        // Server already enforced the 6-stop cap + region rule; `places` is the coherent committed day
        // (empty when the model refused a far request, in which case we leave the day untouched). The
        // model's reply explains any rejected/dropped stops, so there's no separate warning to show.
        const places: PlannerPlace[] = Array.isArray(res.data.places) ? res.data.places : [];
        const committedDays: Array<{
          date: string;
          places: PlannerPlace[];
          dinner: PlannerPlace | null;
          activitySlug: string | null;
        }> = Array.isArray(res.data.days) ? res.data.days : [];
        const recommendations: BmtCandidate[] = Array.isArray(res.data.recommendations)
          ? res.data.recommendations
          : [];
        mergeBmtRecommendations(recommendations);

        if (tripPayload && committedDays.length) {
          // Merge the committed days into the trip by date (uncommitted days stay untouched).
          const dayPlaces = committedDays.flatMap((d) => [
            ...d.places,
            ...(d.dinner ? [d.dinner] : []),
          ]);
          addToCatalog(dayPlaces);
          const prevBySlug = new Map((days ?? []).map((d) => [d.date, d.activitySlug]));
          setDays((prev) => {
            if (!prev) return prev;
            const byDate = new Map(committedDays.map((d) => [d.date, d]));
            return prev.map((d) => {
              const c = byDate.get(d.date);
              return c
                ? {
                    date: d.date,
                    stopIds: c.places.map((p) => p.id),
                    dinnerId: c.dinner?.id ?? null,
                    activitySlug: c.activitySlug,
                  }
                : d;
            });
          });
          // Reply + a branded card for each day that GAINED a recommended activity + the day summary.
          const newActivityCards = committedDays
            .filter((d) => d.activitySlug && prevBySlug.get(d.date) !== d.activitySlug)
            .map(
              (d) =>
                ({
                  role: 'assistant',
                  kind: 'activity',
                  slug: d.activitySlug!,
                  date: d.date,
                }) as ChatMsg,
            );
          setChat((c) => [
            ...c,
            { role: 'assistant', kind: 'text', text: reply },
            ...newActivityCards,
            { role: 'assistant', kind: 'summary' } as ChatMsg,
          ]);
        } else if (!tripPayload && places.length) {
          addToCatalog(places);
          const ids = places.map((p) => p.id);
          const newOnes = ids.filter((id) => !stopIds.includes(id));
          setStopIds(ids);
          setChat((c) => [
            ...c,
            { role: 'assistant', kind: 'text', text: reply },
            ...newOnes.map((id) => ({ role: 'assistant', kind: 'place', id }) as ChatMsg),
            { role: 'assistant', kind: 'summary' } as ChatMsg,
          ]);
        } else {
          setChat((c) => [...c, { role: 'assistant', kind: 'text', text: reply }]);
        }
      } else {
        setChat((c) => [
          ...c,
          {
            role: 'assistant',
            kind: 'text',
            text: t(
              "Sorry — I couldn't reach ZilAi just now. Browse places on the left and I'll keep the price live.",
            ),
          },
        ]);
      }
    } catch {
      setTyping(false);
      setChat((c) => [
        ...c,
        {
          role: 'assistant',
          kind: 'text',
          text: t('Something went wrong — please try again in a moment.'),
        },
      ]);
    }
  }

  function scrollToPlanner() {
    const el = document.getElementById('planner');
    if (el)
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - 60,
        behavior: 'smooth',
      });
  }

  function submitHero() {
    const v =
      heroValue.trim() ||
      (isTrip
        ? 'Plan every day of my trip with the best of Mauritius — include lunch and dinner spots, and recommend your activities where they fit.'
        : 'A relaxed day in the south — two beaches and a waterfall, back by 5pm.');
    scrollToPlanner();
    setMobileTab('chat');
    void sendChat(v);
    setHeroValue('');
  }

  function openPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    addToCatalog(p.places);
    // Replaces the day being viewed (in trip mode: the active day) with the preset.
    setActiveStopIds(() => p.places.map((x) => x.id));
    setHasBuilt(true);
    setBannerTour(null);
    setDrawerOpen(false);
    setMobileTab('day');
    setChat([
      {
        role: 'assistant',
        kind: 'text',
        text: t(
          'Loaded {name} — {n} stops on the map. Make it yours: add a beach, drop a stop, or ask me to reshuffle.',
          { name: p.name, n: p.places.length },
        ),
      },
    ]);
    scrollToPlanner();
  }

  async function bookDay() {
    // Trip mode books the ACTIVE day on its own (locked) date; single-day uses the modal's picker.
    const bookingDate = isTrip ? (activeDay?.date ?? '') : date;
    if (!quote || stops.length === 0 || !bookingDate) return;
    setBooking(true);
    setBookError(null);
    try {
      const avail = await fetch(
        `/api/v1/activities/${CUSTOM_SLUG}/availability?from=${bookingDate}&to=${bookingDate}`,
      ).then((r) => r.json());
      const slots: Array<{ occurrenceId: string; startsAt: string; seatsLeft: number }> = avail.ok
        ? (avail.data ?? [])
        : [];
      const slot = slots.find((s) => utcDayKey(s.startsAt) === bookingDate) ?? slots[0];
      if (!slot) {
        setBookError(t("That date isn't open yet — try another day, or contact us to arrange it."));
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
            expectedSlug: CUSTOM_SLUG,
            people: party,
            idempotencyKey: idem,
          }),
        }).then((r) => r.json());
        if (res.ok) {
          holdId = res.data.holdId;
          expiresAt = res.data.expiresAt;
        }
      } catch {
        /* checkout creates the hold at pay if this failed */
      }
      try {
        window.sessionStorage.setItem(
          `gytm:hold:${occ}`,
          JSON.stringify({ holdId, expiresAt, idem }),
        );
        const itinerary = stops.map((s) => ({
          title: s.name,
          area: s.region,
          lat: s.lat,
          lng: s.lng,
        }));
        window.sessionStorage.setItem(`gytm:itinerary:${CUSTOM_SLUG}`, JSON.stringify(itinerary));
      } catch {
        /* sessionStorage unavailable — checkout falls back */
      }
      const dateText = new Date(`${bookingDate}T00:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const q = new URLSearchParams({
        occ,
        label: quote.vehicle,
        qty: String(party),
        slug: CUSTOM_SLUG,
        title: CUSTOM_TITLE,
        lang: 'en',
        // Include the seat add-on so checkout's price reconciliation matches the modal + server
        // (otherwise a vehicle-only total triggers a spurious "price changed" re-confirm).
        total: String(quote.totalEur + childSeatsCost(Math.min(childSeats, party))),
        when: `${dateText}, ${time}`,
        guests: String(party),
        unit: 'per vehicle',
        suv: suv ? '1' : '0',
        childSeats: String(Math.min(childSeats, party)),
        // Carry the chosen pickup (and a distinct drop-off) so they land on the booking for the driver.
        pickup: pickup.name,
        from: 'widget',
      });
      if (dropoff && dropoff.id !== pickup.id) q.set('dropoff', dropoff.name);
      router.push(`/checkout?${q.toString()}`);
    } catch {
      setBookError(t("We couldn't start your booking just now. Please try again."));
    } finally {
      setBooking(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      /* clipboard blocked — the URL bar already reflects the day */
    }
  }

  // Real Google map: pickup pinned first ("P"), stops numbered 1..n, and the drop-off last ("D") when
  // it differs. With no stops we still show the pickup pin (the customer's starting location).
  const mapStops = [
    { title: pickup.name, lat: pickup.lat, lng: pickup.lng },
    ...stops.map((s) => ({ title: s.name, lat: s.lat, lng: s.lng })),
    ...(dropoffDiffers ? [{ title: dropoff!.name, lat: dropoff!.lat, lng: dropoff!.lng }] : []),
  ];
  const mapKinds: StopKind[] = [
    'start',
    ...stops.map((): StopKind => 'main'),
    ...(dropoffDiffers ? (['start'] as StopKind[]) : []),
  ];
  const mapLabels: Array<string | number> = [
    'P',
    ...stops.map((_, i) => i + 1),
    ...(dropoffDiffers ? ['D'] : []),
  ];

  // ── Belle Mare Tours markers: the active day's recommended activity (always, filled) + the browse
  //    layer (toggle; near the day's region so browsing doesn't flood the map cross-island). ──
  const selectedBmtSlug = activeDay?.activitySlug ?? null;
  const selectedBmt = selectedBmtSlug ? (bmtCatalog.get(selectedBmtSlug) ?? null) : null;
  const activeRegionLabel = dayRegionLabel(dayRegions);
  const mapActivities = useMemo<ActivityMarker[]>(() => {
    const out: ActivityMarker[] = [];
    const priceLabel = (a: BmtInfo | BmtActivity) =>
      a.fromPriceEur != null ? money(a.fromPriceEur) : '•';
    if (selectedBmt && selectedBmt.lat != null && selectedBmt.lng != null) {
      out.push({
        slug: selectedBmt.slug,
        title: selectedBmt.title,
        lat: selectedBmt.lat,
        lng: selectedBmt.lng,
        priceLabel: priceLabel(selectedBmt),
        selected: true,
      });
    }
    if (showBmtLayer && bmtAll) {
      for (const a of bmtAll) {
        if (a.slug === selectedBmtSlug || a.lat == null || a.lng == null) continue;
        if (
          activeRegionLabel &&
          regionDistanceBand(a.region, activeRegionLabel, REGION_DISTANCE_DEFAULT) === 'far'
        )
          continue;
        out.push({
          slug: a.slug,
          title: a.title,
          lat: a.lat,
          lng: a.lng,
          priceLabel: priceLabel(a),
          selected: false,
        });
      }
    }
    return out;
  }, [selectedBmt, selectedBmtSlug, showBmtLayer, bmtAll, activeRegionLabel, money]);
  const dinnerPlace = activeDay?.dinnerId ? (catalog.get(activeDay.dinnerId) ?? null) : null;
  const mapDinner = useMemo(
    () =>
      dinnerPlace ? { title: dinnerPlace.name, lat: dinnerPlace.lat, lng: dinnerPlace.lng } : null,
    [dinnerPlace],
  );
  // The date a clicked marker's card books for: the active trip day, else the quote date.
  const markerDate = activeDay?.date ?? (date || minDate);
  const openBmtInfo = openBmt ? (bmtCatalog.get(openBmt.slug) ?? null) : null;

  const itinerary = (
    <ItineraryPanel
      stops={stops}
      pickup={pickup}
      onPickup={choosePickup}
      dropoff={dropoff}
      onDropoff={setDropoff}
      wantsDropoff={wantsDropoff}
      onWantsDropoff={setWantsDropoff}
      route={route}
      quote={quote}
      onAddPlaces={() => setDrawerOpen(true)}
      dayFull={dayFull}
      onRemove={removeStop}
      onMove={moveStop}
      onQuote={() => setQuoteOpen(true)}
      onShare={copyLink}
      shared={shared}
      dayLabel={
        activeDay
          ? `${t('Day {n}', { n: activeDayIdx + 1 })} — ${dayDateLabel(activeDay.date)}`
          : null
      }
      activity={
        selectedBmt && activeDay
          ? { activity: selectedBmt, date: activeDay.date, seatsLeft: selectedBmt.seatsLeft }
          : null
      }
      onRemoveActivity={activeDay ? () => removeDayActivity(activeDay.date) : undefined}
      dinner={dinnerPlace}
      onRemoveDinner={activeDay ? () => removeDayDinner(activeDay.date) : undefined}
    />
  );
  const copilot = (
    <ChatCopilot
      messages={chat}
      typing={typing}
      boost={boost}
      hasBuilt={hasBuilt}
      stops={stops}
      placesById={catalog}
      stopIndex={stopIndex}
      route={route}
      quote={quote}
      onSend={sendChat}
      onApplyBoost={applyBoost}
      onDismissBoost={() => setBoost(null)}
      onClear={clearTrip}
      onBrowse={() => setDrawerOpen(true)}
      onQuote={() => setQuoteOpen(true)}
      onAddPlace={addStopId}
      addReasonById={(id) => addBlockReason(catalog.get(id)?.region ?? null, dayRegions)}
      bmtBySlug={bmtCatalog}
    />
  );
  const map = (
    <div className="relative h-full w-full">
      <RouteMap
        stops={mapStops}
        kinds={mapKinds}
        labels={mapLabels}
        animate={stops.length > 0}
        carColor="#DC2626"
        className="h-full w-full"
        activities={mapActivities}
        onActivityClick={(slug) => setOpenBmt({ slug, date: markerDate })}
        dinner={mapDinner}
      />
      {/* "Belle Mare Tours activities" browse layer toggle. */}
      <button
        type="button"
        onClick={toggleBmtLayer}
        aria-pressed={showBmtLayer}
        className={`absolute left-3 top-3 z-10 inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-2 text-[12px] font-extrabold shadow-[0_6px_16px_rgba(10,46,54,.18)] transition ${
          showBmtLayer
            ? 'border-coral bg-coral text-white'
            : 'border-[#F8D3CE] bg-white text-coral hover:bg-[#FDECEA]'
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3l2.3 4.7 5.2.3-3.7 3.6.9 5.1L12 14.5 7.3 16.7l.9-5.1L4.5 8l5.2-.3L12 3Z"
            fill={showBmtLayer ? '#fff' : '#F76C5E'}
          />
        </svg>
        {t('Our activities')}
      </button>
      {/* Clicked-marker pop-over: the branded card with the date-aware booking deep-link. */}
      {openBmt && openBmtInfo && (
        <div className="absolute bottom-3 left-3 right-3 z-10 mx-auto max-w-[400px]">
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenBmt(null)}
              aria-label={t('Close')}
              className="absolute -right-2 -top-2 z-10 grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-[#EAF2F1] bg-white text-ink-muted shadow-[0_4px_12px_rgba(10,46,54,.2)]"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <ActivityCard
              compact
              activity={openBmtInfo}
              date={openBmt.date}
              seatsLeft={openBmtInfo.seatsLeft}
            />
          </div>
        </div>
      )}
    </div>
  );
  const drawer = (
    <PlacesDrawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      selectedIds={stopIds}
      onAdd={addPlace}
      addReason={(region) => addBlockReason(region, dayRegions)}
    />
  );

  return (
    <main className="min-h-screen bg-white">
      <HeroSection
        value={heroValue}
        onChange={setHeroValue}
        onSubmit={submitHero}
        onChip={(c) => {
          setHeroValue(c);
          scrollToPlanner();
          setMobileTab('chat');
          void sendChat(c);
          setHeroValue('');
        }}
        from={rangeFrom}
        to={rangeTo}
        onFrom={(v) => applyRange(v, rangeTo)}
        onTo={(v) => applyRange(rangeFrom, v)}
        minDate={minDate}
        isTrip={isTrip}
      />

      <div id="planner" style={{ background: 'linear-gradient(180deg,#FFFFFF, #F6FBFA)' }}>
        {bannerTour && (
          <div className="mx-auto max-w-shell px-[22px] pt-3.5">
            <div
              className="flex items-center gap-3 rounded-[14px] border border-[#D8ECEA] px-[15px] py-[11px]"
              style={{ background: 'linear-gradient(120deg,#EAF7F5,#fff)' }}
            >
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-coral">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 3l2.3 4.7L19.5 8l-3.7 3.6.9 5.1L12 14.5 7.3 16.7l.9-5.1L4.5 8l5.2-.3L12 3Z"
                    fill="#fff"
                  />
                </svg>
              </span>
              <div className="flex-1">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.05em] text-coral">
                  {t('Customizing')}
                </span>
                <div className="text-[14.5px] font-bold text-ink">
                  {t('{tour} — make it yours', { tour: bannerTour })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBannerTour(null)}
                aria-label={t('Dismiss')}
                className="cursor-pointer p-1.5 text-ink-muted"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        {isMobile ? (
          <div className="px-3 pt-2.5">
            {isTrip && days && (
              <div className="mb-2.5">
                <DayTabs
                  days={days}
                  activeIdx={activeDayIdx}
                  onSelect={(i) => {
                    setActiveDayIdx(i);
                    setOpenBmt(null);
                  }}
                  onExit={exitTrip}
                />
              </div>
            )}
            <div className="relative h-[calc(100vh-220px)] min-h-[460px] overflow-hidden rounded-[18px] border border-[#EAF2F1] bg-white shadow-[0_14px_34px_rgba(10,46,54,.08)]">
              <div className="h-full">
                {mobileTab === 'chat' ? copilot : mobileTab === 'map' ? map : itinerary}
              </div>
              {drawer}
            </div>
            <div className="sticky bottom-0 mt-2.5 flex gap-1.5 rounded-[16px] border border-[#EAF2F1] bg-white p-1.5 shadow-[0_10px_24px_rgba(10,46,54,.1)]">
              {(
                [
                  ['chat', 'ZilAi'],
                  ['day', 'Your day'],
                  ['map', 'Map'],
                ] as const
              ).map(([k, lab]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMobileTab(k)}
                  className={`flex-1 cursor-pointer rounded-[11px] py-2.5 text-[13px] font-bold ${mobileTab === k ? 'bg-teal-tint text-teal-dark' : 'bg-transparent text-ink-muted'}`}
                >
                  {t(lab)}
                </button>
              ))}
            </div>
            {stops.length > 0 && (
              <div className="sticky bottom-0 mt-2.5 flex items-center gap-3 rounded-[16px] bg-ink px-3.5 py-[11px] shadow-[0_12px_28px_rgba(10,46,54,.28)]">
                <div className="flex-1 text-white">
                  <div className="text-[12.5px] font-bold">
                    {t('{n} stops · {dur} driving', {
                      n: stops.length,
                      dur: fmtDur(route.totalMinutes),
                    })}
                  </div>
                  <div className="text-xs text-[#9FD2CD]">
                    ~{quote ? <Price eur={quote.totalEur} /> : '—'} {t('estimate')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setQuoteOpen(true)}
                  className="cursor-pointer rounded-xl bg-coral px-[18px] py-[11px] text-sm font-extrabold text-white"
                >
                  {t('Get quote')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-shell px-[22px] pb-2 pt-[18px]">
            {isTrip && days && (
              <div className="mb-3">
                <DayTabs
                  days={days}
                  activeIdx={activeDayIdx}
                  onSelect={(i) => {
                    setActiveDayIdx(i);
                    setOpenBmt(null);
                  }}
                  onExit={exitTrip}
                />
              </div>
            )}
            <div
              className="grid h-[min(720px,80vh)] gap-4"
              style={{ gridTemplateColumns: '330px 1fr 0.86fr' }}
            >
              <div className="overflow-hidden rounded-[18px] border border-[#EAF2F1] shadow-[0_18px_44px_rgba(10,46,54,.07)]">
                {itinerary}
              </div>
              <div className="relative overflow-hidden rounded-[18px] border border-[#EAF2F1] shadow-[0_18px_44px_rgba(10,46,54,.08)]">
                {copilot}
                {drawer}
              </div>
              <div className="overflow-hidden rounded-[18px] border border-[#EAF2F1] shadow-[0_18px_44px_rgba(10,46,54,.07)]">
                {map}
              </div>
            </div>
          </div>
        )}

        <AIInsights stops={stops} />
      </div>

      <PresetsSection items={presetCards} onOpen={openPreset} />
      <FeaturesSection />
      <TrustSection />
      <FaqSection />

      <QuoteModal
        open={quoteOpen}
        onClose={() => setQuoteOpen(false)}
        stops={stops}
        route={route}
        quote={quote}
        quoteError={quoteError}
        maxParty={pricing.maxParty}
        date={isTrip ? (activeDay?.date ?? date) : date}
        setDate={setDate}
        minDate={minDate}
        lockedDate={isTrip ? (activeDay?.date ?? null) : null}
        time={time}
        setTime={setTime}
        party={party}
        setParty={setParty}
        suv={suv}
        setSuv={setSuv}
        childSeats={childSeats}
        setChildSeats={setChildSeats}
        booking={booking}
        bookError={bookError}
        onBook={bookDay}
      />
    </main>
  );
}
