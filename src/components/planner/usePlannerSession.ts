'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlannerData } from './usePlannerData';
import type { ActivityMarker, StopKind } from '@/components/maps/RouteMap';
import type { PresetCard } from './PresetsSection';
import { PICKUPS, PRESETS, fmtDur, type PlannerPoint } from './planner-constants';
import { reportClientError } from '@/lib/client-error-report';
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
import { detectPickup, geolocationAlreadyGranted } from '@/lib/geo/detect-pickup';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { ChatMsg, Boost, TripProposal } from './types';
import { buildPreviewIndex, findPreview, type PlacePreview } from '@/lib/planner/place-lookup';
import {
  deleteSavedChat,
  hasVisitorTurn,
  isWorthSaving,
  loadSavedChats,
  persistChat,
  planSignature,
  snapshotTitle,
  type CanvasView,
  type PlannerSnapshot,
  type SavedChat,
  type StopNote,
} from '@/lib/planner/chat-history';
import { useMoney, useT } from '@/components/site/PreferencesProvider';

export const PLANNER_PATH = '/ai-road-trip-planner';

/** True on the planner's own route (in either language) — the only page whose URL carries a plan. */
function onPlannerRoute(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.endsWith(PLANNER_PATH);
}

const CUSTOM_SLUG = 'custom-road-trip';
const CUSTOM_TITLE = 'Custom Road Trip';

/** Belle Mare Tours activity info the shell keeps per slug — the catalogue data plus, when it came
 *  from an availability-checked recommendation, the real seats left on its date. */
type BmtInfo = BmtActivity & { seatsLeft?: number | null };

/** "Tue 2 Sep" style label for a trip day. */
function dayDateLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? dayKey
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Which pane a small screen should bring forward (it shows one at a time). */
export type SessionPane = 'chat' | 'plan' | 'map';

/**
 * One planning session with ZilAi: the conversation, the day or trip it has built, and everything
 * derived from them. `stopIds` + `pickup` are the source of truth; route, drive times, price and the
 * share link all derive from them. Places are live Google Places — every place met (searched,
 * AI-chosen, preset, deep-linked) is kept in a `catalog` so any stop can be drawn.
 *
 * This is the state the old three-pane PlannerShell owned, lifted out so the assistant panel, the
 * results canvas and the landing page can share one session that survives moving between pages.
 * "Get my quote" still runs the live availability → hold → /checkout booking, unchanged.
 */
export function usePlannerSession(onFocusPane: (pane: SessionPane) => void) {
  // Behind a ref so a new callback identity never re-creates the operations below.
  const focusRef = useRef(onFocusPane);
  focusRef.current = onFocusPane;
  const focusPane = useCallback((pane: SessionPane) => focusRef.current(pane), []);
  const router = useRouter();
  const t = useT();
  const money = useMoney();
  const { pricing } = usePlannerData();

  const [catalog, setCatalog] = useState<Map<string, PlannerPlace>>(new Map());
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
  // The one-time fetch behind the "Our activities" toggle is in flight — the button says so rather
  // than looking inert while the layer loads.
  const [bmtLoading, setBmtLoading] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState(false);
  const [hasBuilt, setHasBuilt] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [party, setParty] = useState(2);
  const [suv, setSuv] = useState(false);
  const [childSeats, setChildSeats] = useState(0);
  const [date, setDate] = useState('');
  // Whether `date` is the visitor's OWN pick rather than the tomorrow default seeded on mount. The
  // quote widget needs a date pre-filled to work, but nothing else may treat that seed as a decision:
  // a map-pin card that says "book for 4 Aug" presents a day the visitor never chose as already
  // settled. Set only where a human actually picks a day.
  const [dateChosen, setDateChosen] = useState(false);
  const [minDate, setMinDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [boost, setBoost] = useState<Boost | null>(null);
  const [bannerTour, setBannerTour] = useState<string | null>(null);
  // ── the assistant's own state: hearted stops, what ZilAi wrote about each stop, its name for the
  //    day(s), the request the plan answers, and how the canvas is showing it ──
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Map<string, StopNote>>(new Map());
  const [dayTitles, setDayTitles] = useState<Map<string, string>>(new Map());
  const [prompt, setPrompt] = useState('');
  const [view, setView] = useState<CanvasView>('list');
  // Whether "use my current location" may be offered. Asked of the server once per session (see
  // /api/planner/locality) — it used to be a page prop, which a site-wide assistant cannot have.
  const [mayUseDeviceLocation, setMayUseDeviceLocation] = useState(false);
  const [shared, setShared] = useState(false);
  // ── saved chats: this conversation's id, the shelf we render, and which proposals were accepted ──
  const [sessionId, setSessionId] = useState('');
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [appliedProposals, setAppliedProposals] = useState<Set<string>>(new Set());
  const initRef = useRef(false);
  // Bumped to make the deep-link effect read the URL again (see `restoreFromUrl`).
  const [restoreNonce, setRestoreNonce] = useState(0);
  const lastOptimizedKey = useRef('');
  /** The plan this visit OPENED with (a shared link). A session that only looks at it has nothing new
   *  to remember — the link already carries the plan — so history stays a shelf of real work. */
  const openedPlan = useRef('');

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

  // ── mount: dates + locality ──
  useEffect(() => {
    // Earliest bookable day is TOMORROW (we don't fulfil same-day) — the server rejects today too.
    const tomorrow = new Date(Date.now() + 86_400_000);
    setMinDate(nominalDayKey(tomorrow));
    setDate(nominalDayKey(tomorrow));
    let active = true;
    fetch('/api/planner/locality')
      .then((r) => r.json())
      .then((res) => {
        if (active && res.ok) setMayUseDeviceLocation(Boolean(res.data?.mayUseDeviceLocation));
      })
      .catch(() => {
        /* the button simply stays hidden; searching for a pick-up always works */
      });
    return () => {
      active = false;
    };
  }, []);

  // ── customising one of our tours ──
  /** The tour whose stops are loaded as the starting point, if any. */
  const [tourSlug, setTourSlug] = useState<string | null>(null);
  /**
   * Hand a sightseeing tour's itinerary to the session: its stops are resolved server-side into real
   * places and loaded as the day, ready to be changed. A tour page's "Customize this tour" calls this
   * with the assistant opening in place; the `?fromTour=` link form calls it after a page load.
   */
  const loadTour = useCallback(
    async (slug: string) => {
      setTourSlug(slug);
      try {
        const res = await fetch(`/api/planner/from-tour?slug=${encodeURIComponent(slug)}`).then(
          (r) => r.json(),
        );
        const tourName: string | null = res.ok ? (res.data?.tour ?? null) : null;
        const places: PlannerPlace[] =
          res.ok && Array.isArray(res.data?.places) ? res.data.places : [];
        if (tourName) setBannerTour(tourName.slice(0, 80));
        if (places.length) {
          addToCatalog(places);
          openedPlan.current = planSignature(
            places.map((p) => p.id),
            null,
          );
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
    },
    [addToCatalog, t],
  );

  // ── mount: deep-link. `?fromTour=slug` hands a sightseeing tour's itinerary to the planner (stops
  //    resolved server-side); `?stops=placeId,placeId&tour=Name` is the shareable form. ──
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    // Only the planner's own URL carries a plan. Opened from any other page, the assistant must not
    // read that page's query string as one.
    if (!onPlannerRoute()) return;
    const params = new URLSearchParams(window.location.search);

    // A shared TRIP link (?from&to&dN…) restores the whole multi-day plan and wins over the
    // single-day deep-links below.
    const tripPlan = parseTripParams(params, MAX_STOPS);
    if (tripPlan) {
      openedPlan.current = planSignature([], tripPlan);
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
      void loadTour(fromTour);
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
            openedPlan.current = planSignature(
              places.map((p) => p.id),
              null,
            );
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
  }, [addToCatalog, t, restoreNonce, loadTour]);
  /** Read the plan out of the current URL again. The session outlives pages now, so a visitor who
   *  already has the assistant running can still arrive at a shared link and have it load. */
  const restoreFromUrl = useCallback(() => {
    initRef.current = false;
    setRestoreNonce((n) => n + 1);
  }, []);

  // ── shareable URL ──
  useEffect(() => {
    if (!initRef.current || !onPlannerRoute()) return;
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
        // A single picked day still primes the booking date — and that IS the visitor's own pick.
        if (dates.length === 1) {
          setDate(dates[0]!);
          setDateChosen(true);
        }
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
  /** Load the catalogue list once. Anchored activity cards, branded markers and the chat's hover
   *  previews all need it, so it can't stay welded to the map's browse toggle. */
  const ensureBmtList = useCallback(async () => {
    if (bmtAll !== null) return;
    setBmtLoading(true);
    try {
      const res = await fetch('/api/planner/our-activities').then((r) => r.json());
      const list: BmtActivity[] = res.ok ? res.data : [];
      setBmtAll(list);
      mergeBmtList(list);
    } catch {
      setBmtAll([]); // failed fetch: callers just show nothing extra
    } finally {
      setBmtLoading(false);
    }
  }, [bmtAll, mergeBmtList]);
  const toggleBmtLayer = useCallback(() => {
    setShowBmtLayer((on) => !on);
    void ensureBmtList();
  }, [ensureBmtList]);

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
    (id: string) => {
      setActiveStopIds((prev) => prev.filter((x) => x !== id));
      // A heart means "keep this"; removing the stop by hand withdraws it.
      setPinnedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [setActiveStopIds],
  );
  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
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
    setSessionId(crypto.randomUUID());
    openedPlan.current = '';
    setPinnedIds(new Set());
    setNotes(new Map());
    setDayTitles(new Map());
    setPrompt('');
    setView('list');
    setAppliedProposals(new Set());
    setBannerTour(null);
    setTourSlug(null);
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
  // Every write bumps `pickupWriteSeq`, which is how the async detection below knows whether the
  // pick-up moved under it while it was awaiting a fix + a reverse geocode.
  const choosePickup = useCallback((p: PlannerPoint) => {
    pickupWriteSeq.current += 1;
    setPickup(p);
    setDropoff((d) => (d && d.id === p.id ? null : d));
  }, []);

  // ── "Use my current location" (Mauritius only) ──
  /** Monotonic stamp of the last pick-up write from ANY source (manual pick, preset, restore). An
   *  in-flight detection captures it before starting and abandons if it changed — which covers every
   *  present and future write path without a new check per path. */
  const pickupWriteSeq = useRef(0);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const autoTriedRef = useRef(false);

  /** Human, actionable copy per failure. Only ever shown for an EXPLICIT attempt. */
  const locateMessage = useCallback(
    (reason: string) =>
      reason === 'outside-mauritius'
        ? t("That doesn't look like a Mauritius location — please search for your pick-up.")
        : reason === 'denied'
          ? t('Location is blocked for this site — allow it in your browser, or search below.')
          : reason === 'imprecise'
            ? t("Your location isn't precise enough to pick you up — please search for it.")
            : reason === 'insecure'
              ? t('Location needs a secure connection — please search for your pick-up.')
              : reason === 'unsupported'
                ? t("Your browser can't share a location — please search for your pick-up.")
                : t("We couldn't get your location — please search for your pick-up."),
    [t],
  );

  /** Detect and apply. `explicit` = the visitor tapped the button (may show errors + fall back to
   *  coordinates); otherwise this is the silent automatic path and every failure is a no-op. */
  const runPickupDetection = useCallback(
    async (explicit: boolean) => {
      const seq = pickupWriteSeq.current;
      if (explicit) {
        setLocating(true);
        setLocateError(null);
      }
      try {
        const found = await detectPickup({ explicit });
        // Re-check AFTER the awaits, not just before them: the visitor may have chosen a pick-up
        // while we were geocoding, and silently overwriting it would send a driver to the wrong place.
        if (pickupWriteSeq.current !== seq) return;
        if (found.ok) {
          choosePickup({ id: found.id, name: found.name, lat: found.lat, lng: found.lng });
        } else if (explicit) {
          setLocateError(locateMessage(found.reason));
        }
      } catch {
        if (explicit) setLocateError(locateMessage('unknown'));
      } finally {
        if (explicit) setLocating(false);
      }
    },
    [choosePickup, locateMessage],
  );

  // Automatic path: only for visitors we may offer this to, and only when the permission was ALREADY
  // granted — so no unrequested prompt ever appears (browsers penalise those, and a dismissal can
  // poison the permission for the whole origin). Everyone else gets the one-tap button instead.
  useEffect(() => {
    if (!mayUseDeviceLocation || autoTriedRef.current) return;
    autoTriedRef.current = true;
    let active = true;
    (async () => {
      if (!(await geolocationAlreadyGranted())) return;
      // Don't touch a pick-up the visitor (or a shared link) already established.
      if (!active || pickupWriteSeq.current !== 0) return;
      await runPickupDetection(false);
    })();
    return () => {
      active = false;
    };
  }, [mayUseDeviceLocation, runPickupDetection]);

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

  // ── saved chats ──────────────────────────────────────────────────────────────────────────────
  // The conversation lives in the visitor's own browser (see chat-history.ts): the planner is public,
  // and the URL already carries the plan but never the chat or the resolved Google places.

  // One id per visit, minted on mount so every save overwrites this session's slot instead of
  // filling the shelf with near-identical copies.
  useEffect(() => {
    setSessionId(crypto.randomUUID());
    setSavedChats(loadSavedChats());
  }, []);

  /** Everything needed to put the visitor back where they left off. */
  const buildSnapshot = useCallback((): PlannerSnapshot => {
    const ids = new Set<string>(stopIds);
    for (const d of days ?? []) {
      for (const id of d.stopIds) ids.add(id);
      if (d.dinnerId) ids.add(d.dinnerId);
    }
    for (const m of chat) if (m.kind === 'place') ids.add(m.id);
    return {
      chat,
      stopIds,
      days,
      places: [...ids].map((id) => catalog.get(id)).filter((p): p is PlannerPlace => Boolean(p)),
      pickup: { id: pickup.id, name: pickup.name, lat: pickup.lat, lng: pickup.lng },
      dropoff: dropoff
        ? { id: dropoff.id, name: dropoff.name, lat: dropoff.lat, lng: dropoff.lng }
        : null,
      // Only what the saved plan still refers to — a note for a stop long since removed is dead
      // weight against the storage budget.
      pinnedIds: [...pinnedIds].filter((id) => ids.has(id)),
      notes: Object.fromEntries([...notes].filter(([id]) => ids.has(id))),
      dayTitles: Object.fromEntries(dayTitles),
      prompt,
      view,
    };
  }, [chat, stopIds, days, catalog, pickup, dropoff, pinnedIds, notes, dayTitles, prompt, view]);

  // Save as they go, debounced — a chat is worth resuming long before they think to save it, and
  // there is no "save" button to forget to press.
  useEffect(() => {
    if (!sessionId) return;
    const snapshot = buildSnapshot();
    if (!isWorthSaving(snapshot)) return;
    // Opening a shared link and just looking at it isn't work worth remembering — the link already
    // carries that plan, and saving it would mint a fresh near-duplicate entry on every reload.
    if (!hasVisitorTurn(snapshot) && planSignature(stopIds, days) === openedPlan.current) return;
    const timer = setTimeout(() => {
      setSavedChats(
        persistChat({
          id: sessionId,
          savedAt: Date.now(),
          title: snapshotTitle(snapshot),
          snapshot,
        }),
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [sessionId, buildSnapshot, stopIds, days]);

  /** Reopen a saved chat: its conversation, its day/trip and the places both need to render. */
  const resumeChat = useCallback(
    (saved: SavedChat) => {
      const s = saved.snapshot;
      addToCatalog(s.places);
      setChat(s.chat);
      setStopIds(s.stopIds);
      setDays(s.days);
      setActiveDayIdx(0);
      setRangeFrom(s.days?.[0]?.date ?? '');
      setRangeTo(s.days?.[s.days.length - 1]?.date ?? '');
      setPickup(s.pickup);
      setDropoff(s.dropoff);
      setWantsDropoff(Boolean(s.dropoff));
      setBoost(null);
      setTyping(false);
      setPinnedIds(new Set(s.pinnedIds ?? []));
      setNotes(new Map(Object.entries(s.notes ?? {})));
      setDayTitles(new Map(Object.entries(s.dayTitles ?? {})));
      setPrompt(s.prompt ?? '');
      setView(s.view ?? 'list');
      setHasBuilt(s.chat.length > 0 || s.stopIds.length > 0);
      // Resuming continues that conversation, so later saves overwrite ITS slot rather than
      // leaving the visitor with two copies of the same plan.
      setSessionId(saved.id);
      // A restored trip may anchor activities whose catalogue data this visit never loaded.
      if ((s.days ?? []).some((d) => d.activitySlug)) void ensureBmtList();
      const hasPlan = s.stopIds.length > 0 || (s.days ?? []).some((d) => d.stopIds.length > 0);
      focusPane(hasPlan ? 'plan' : 'chat');
    },
    [addToCatalog, ensureBmtList, focusPane],
  );

  const removeSavedChat = useCallback((id: string) => setSavedChats(deleteSavedChat(id)), []);

  // ── hover previews for the names ZilAi emphasises ──
  // Our own tours are indexed first: when a name matches both a catalogue tour and a Google place,
  // the bookable one is what the visitor wants to see.
  const previewIndex = useMemo(() => {
    const previews: PlacePreview[] = [];
    for (const a of bmtCatalog.values()) {
      previews.push({
        name: a.title,
        category: a.category,
        region: a.region,
        blurb: a.summary,
        facts: a.durationMinutes ? [fmtDur(a.durationMinutes)] : [],
        images: a.imageUrls?.length ? a.imageUrls : a.heroImageUrl ? [a.heroImageUrl] : [],
        href: `/activities/${a.slug}`,
        priceLabel: a.fromPriceEur != null ? t('from {p}', { p: money(a.fromPriceEur) }) : null,
        ratingLabel: a.ratingAvg != null ? `★ ${a.ratingAvg.toFixed(1)} (${a.ratingCount})` : null,
      });
    }
    for (const p of catalog.values()) {
      previews.push({
        name: p.name,
        category: p.category,
        region: p.region,
        blurb: p.blurb,
        // Google gives an editorial summary for only a minority of places, so the card leans on the
        // facts we always have: how long a stop there takes, and when it shuts.
        facts: [
          t('{d} here', { d: fmtDur(p.durationMin) }),
          ...(p.closesAt ? [t('closes {time}', { time: p.closesAt })] : []),
        ],
        images: p.imageUrls?.length ? p.imageUrls : p.imageUrl ? [p.imageUrl] : [],
        href: null,
        priceLabel: null,
        ratingLabel: null,
      });
    }
    return buildPreviewIndex(previews);
  }, [bmtCatalog, catalog, money, t]);
  const previewByName = useCallback(
    (name: string) => findPreview(previewIndex, name),
    [previewIndex],
  );

  /** Accept ZilAi's proposed split: the range becomes real days, each carrying its offered tour. */
  const acceptProposal = useCallback(
    (proposal: TripProposal) => {
      applyRange(proposal.from, proposal.to);
      const bySlug = new Map(proposal.days.map((d) => [d.date, d.activitySlug]));
      setDays((prev) =>
        prev
          ? prev.map((d) => (bySlug.has(d.date) ? { ...d, activitySlug: bySlug.get(d.date)! } : d))
          : prev,
      );
      setAppliedProposals((s) => new Set(s).add(proposal.from));
      setHasBuilt(true);
      // Anchored cards + branded markers need the catalogue list.
      void ensureBmtList();
    },
    [applyRange, ensureBmtList],
  );

  const mergeNotes = useCallback((list: TurnNote[]) => {
    if (!list.length) return;
    setNotes((prev) => {
      const next = new Map(prev);
      for (const n of list) {
        if (n && typeof n.placeId === 'string' && (n.why || n.tip)) {
          next.set(n.placeId, { why: n.why ?? null, tip: n.tip ?? null });
        }
      }
      return next;
    });
  }, []);

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
          ...(pinnedIds.size ? { pinnedIds: [...pinnedIds] } : {}),
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
          title?: string | null;
          notes?: TurnNote[];
        }> = Array.isArray(res.data.days) ? res.data.days : [];
        // What ZilAi wrote for the result cards this turn, whichever mode it committed in.
        mergeNotes([
          ...(Array.isArray(res.data.notes) ? (res.data.notes as TurnNote[]) : []),
          ...committedDays.flatMap((d) => (Array.isArray(d.notes) ? d.notes : [])),
        ]);
        const recommendations: BmtCandidate[] = Array.isArray(res.data.recommendations)
          ? res.data.recommendations
          : [];
        mergeBmtRecommendations(recommendations);
        // A multi-day split ZilAi is OFFERING — rendered as a card under its reply. Nothing changes
        // until the visitor taps it, so a proposal can never reshape a plan behind their back.
        const proposal: TripProposal | null =
          res.data.proposedTrip && Array.isArray(res.data.proposedTrip.days)
            ? (res.data.proposedTrip as TripProposal)
            : null;
        const proposalCards: ChatMsg[] = proposal
          ? [{ role: 'assistant', kind: 'trip-proposal', proposal }]
          : [];

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
          setDayTitles((prev) => {
            const next = new Map(prev);
            for (const d of committedDays) if (d.title) next.set(d.date, d.title);
            return next;
          });
          setPrompt(keepFirst(trimmed));
          focusPane('plan');
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
            ...proposalCards,
            { role: 'assistant', kind: 'summary' } as ChatMsg,
          ]);
        } else if (!tripPayload && places.length) {
          addToCatalog(places);
          setStopIds(places.map((p) => p.id));
          if (typeof res.data.title === 'string' && res.data.title) {
            setDayTitles((prev) => new Map(prev).set(SINGLE_DAY, res.data.title as string));
          }
          setPrompt(keepFirst(trimmed));
          focusPane('plan');
          // The stops themselves are the canvas's job now — the chat keeps the words and one
          // summary chip that reopens the plan.
          setChat((c) => [
            ...c,
            { role: 'assistant', kind: 'text', text: reply },
            ...proposalCards,
            { role: 'assistant', kind: 'summary' } as ChatMsg,
          ]);
        } else {
          setChat((c) => [
            ...c,
            { role: 'assistant', kind: 'text', text: reply },
            ...proposalCards,
          ]);
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

  function openPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    addToCatalog(p.places);
    // Replaces the day being viewed (in trip mode: the active day) with the preset.
    setActiveStopIds(() => p.places.map((x) => x.id));
    setHasBuilt(true);
    setBannerTour(null);
    setDrawerOpen(false);
    setPrompt(p.name);
    focusPane('plan');
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
      // Built BEFORE the hold so it can travel with it. The day's stops are the whole deliverable of
      // a custom road trip, and they used to reach the server only at pay, carried across the
      // planner→checkout gap by sessionStorage alone — so a browser that dropped that key produced a
      // paid trip with no route and no way to recover one (BMTFF77DC5CDD471, 9 Aug 2026). Sending it
      // with the hold means the server has it from the first moment it knows about this booking.
      const itinerary = stops.map((s) => ({
        title: s.name,
        area: s.region,
        lat: s.lat,
        lng: s.lng,
      }));
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
            itinerary,
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
        window.sessionStorage.setItem(`gytm:itinerary:${CUSTOM_SLUG}`, JSON.stringify(itinerary));
      } catch (err) {
        // Checkout still falls back to the hold's copy, so this is no longer fatal — but it is the
        // exact moment the old bug began, and it happened in total silence. Now it lands in
        // error_logs, where the owner's "what broke?" query can see it. Reporting only; a storage
        // failure must never stop a booking that the server can complete without it.
        reportClientError({
          kind: 'planner-itinerary-stash-failed',
          message: err instanceof Error ? err.message : 'sessionStorage write failed',
          source: `stops=${itinerary.length} hold=${holdId ? 'yes' : 'no'}`,
        });
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

  /** The link that restores this plan — always the planner's own URL, whichever page the visitor
   *  has the assistant open on. */
  function shareUrl(): string {
    const params = new URLSearchParams();
    if (days !== null) tripToParams(params, days);
    else if (stopIds.length) params.set('stops', stopsToParam(stopIds));
    const prefix = window.location.pathname.startsWith('/fr') ? '/fr' : '';
    const qs = params.toString();
    return `${window.location.origin}${prefix}${PLANNER_PATH}${qs ? `?${qs}` : ''}`;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl());
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
        imageUrl: selectedBmt.heroImageUrl,
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
          imageUrl: a.heroImageUrl,
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
  /**
   * The date a clicked marker asks about — the visitor's OWN choice only: the active trip day, or a
   * date they picked in the quote widget. Null when they haven't chosen, which is the common case on
   * a fresh visit: `date` is seeded with tomorrow so the quote widget works, and treating that seed
   * as a decision made the pin card announce "book for 4 Aug" for a day nobody had picked.
   */
  const markerDate = activeDay?.date ?? (dateChosen ? date : null);

  /**
   * Tapping a branded activity pin hands the activity to ZilAi rather than opening a static
   * pop-over: it asks the co-pilot about that exact activity (which answers from the catalogue via
   * search_our_activities — real price, rating, duration, and seats once a date is known), and drops
   * the bookable card into the chat immediately, so the visitor can act without waiting for the
   * reply. On mobile the chat tab is brought forward, or the conversation would happen on a pane the
   * visitor can't see.
   *
   * With no date chosen we ask WITHOUT one: ZilAi describes the activity and asks which day, and the
   * card sends them to the activity page to pick a date there — never a date we invented for them.
   */
  function askAboutActivity(slug: string) {
    const info = bmtCatalog.get(slug);
    if (!info) return;
    focusPane('chat');
    void sendChat(
      markerDate
        ? t(
            "Tell me about {title} — what's included and what's the price? Can I book it for {date}?",
            { title: info.title, date: markerDate },
          )
        : t(
            "Tell me about {title} — what's included, what's the price, and which dates can I do it?",
            { title: info.title },
          ),
    );
    // Queued AFTER sendChat's own user-message update, so the card lands under the question.
    setChat((c) => [...c, { role: 'assistant', kind: 'activity', slug, date: markerDate }]);
  }

  /** "Regenerate unpinned": keep the hearted stops, ask ZilAi to replace the rest. The server
   *  re-inserts any hearted stop the model drops, so this is a promise rather than a request. */
  function regenerate() {
    void sendChat(
      activeDay
        ? t('Regenerate {day} — keep the stops I hearted and swap the rest for different places.', {
            day: dayDateLabel(activeDay.date),
          })
        : t(
            'Regenerate my plan — keep the stops I hearted and swap the rest for different places.',
          ),
    );
  }

  /** Start planning from the landing page's hero or a suggestion: optional dates first, then the ask. */
  function startWith(text: string) {
    focusPane('chat');
    void sendChat(text);
  }

  // ── card text for stops ZilAi never wrote about (a preset, a shared link, a place added by hand)
  //    and that Google has no summary for. One background request per new batch, never repeated. ──
  const insightAsked = useRef(new Set<string>());
  useEffect(() => {
    if (typing) return;
    const missing = stops.filter(
      (p) => !notes.has(p.id) && !p.blurb && !insightAsked.current.has(p.id),
    );
    if (!missing.length) return;
    const timer = setTimeout(async () => {
      missing.forEach((p) => insightAsked.current.add(p.id));
      try {
        const res = await fetch('/api/ai/place-insights', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            places: missing.map((p) => ({ name: p.name, category: p.category, region: p.region })),
          }),
        }).then((r) => r.json());
        const items: Array<{ name: string; insight: string }> = res.ok
          ? (res.data?.insights?.items ?? [])
          : [];
        const byName = new Map(items.map((i) => [i.name.trim().toLowerCase(), i.insight]));
        mergeNotes(
          missing.flatMap((p) => {
            const why = byName.get(p.name.trim().toLowerCase());
            return why ? [{ placeId: p.id, why, tip: null }] : [];
          }),
        );
      } catch {
        /* the card simply shows its facts without a sentence */
      }
    }, 1400);
    return () => clearTimeout(timer);
  }, [stops, notes, typing, mergeNotes]);

  const dayTitle = dayTitles.get(activeDay?.date ?? SINGLE_DAY) ?? null;
  const hasPlan = isTrip
    ? (days ?? []).some((d) => d.stopIds.length > 0 || d.activitySlug)
    : stopIds.length > 0;

  return {
    // conversation
    chat,
    typing,
    hasBuilt,
    sendChat,
    startWith,
    regenerate,
    boost,
    applyBoost,
    dismissBoost: () => setBoost(null),
    appliedProposals,
    acceptProposal,
    previewByName,
    // the plan
    prompt,
    hasPlan,
    stops,
    stopIndex,
    route,
    dayTitle,
    notes,
    pinnedIds,
    togglePin,
    removeStop,
    moveStop,
    addStopId,
    addPlace,
    addReasonForRegion: (region: string | null) => addBlockReason(region, dayRegions),
    dayFull,
    view,
    setView,
    openPreset,
    presetCards,
    bannerTour,
    dismissBanner: () => setBannerTour(null),
    // trip
    isTrip,
    days,
    activeDay,
    activeDayIdx,
    setActiveDayIdx,
    rangeFrom,
    rangeTo,
    applyRange,
    exitTrip,
    dayDateLabel,
    selectedBmt,
    removeDayActivity,
    dinnerPlace,
    removeDayDinner,
    bmtCatalog,
    // map
    mapStops,
    mapKinds,
    mapLabels,
    mapActivities,
    mapDinner,
    askAboutActivity,
    showBmtLayer,
    toggleBmtLayer,
    bmtLoading,
    // pick-up
    pickup,
    choosePickup,
    dropoff,
    setDropoff,
    wantsDropoff,
    setWantsDropoff,
    mayUseDeviceLocation,
    locating,
    locateError,
    useMyLocation: () => void runPickupDetection(true),
    // quote + booking
    pricing,
    quote,
    quoteError,
    party,
    setParty,
    suv,
    setSuv,
    childSeats,
    setChildSeats,
    date,
    setDate: (d: string) => {
      setDate(d);
      setDateChosen(true);
    },
    minDate,
    time,
    setTime,
    quoteOpen,
    setQuoteOpen,
    booking,
    bookError,
    bookDay,
    drawerOpen,
    setDrawerOpen,
    activeStopIds,
    // sharing + saved chats
    copyLink,
    shared,
    catalog,
    sessionId,
    savedChats,
    resumeChat,
    removeSavedChat,
    newChat: clearTrip,
    restoreFromUrl,
    loadTour,
    tourSlug,
  };
}

/** The canvas is headed by the request the plan answers. "Add a beach" and "regenerate" change
 *  that plan; they are not what it is a result FOR — so the first request stands until a new chat. */
const keepFirst = (text: string) => (current: string) => current || text;

/** The key a single (date-less) day's title is stored under. */
const SINGLE_DAY = 'single';

/** One stop's card text as a turn returns it. */
type TurnNote = { placeId: string; why?: string | null; tip?: string | null };

export type PlannerSession = ReturnType<typeof usePlannerSession>;
