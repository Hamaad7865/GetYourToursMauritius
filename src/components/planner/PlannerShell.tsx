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
import { RouteMap } from '@/components/maps/RouteMap';
import { PresetsSection, type PresetCard } from './PresetsSection';
import { FeaturesSection } from './FeaturesSection';
import { TrustSection } from './TrustSection';
import { FaqSection } from './FaqSection';
import { PICKUPS, PRESETS, fmtDur } from './planner-constants';
import { computePlannerRoute } from '@/lib/planner/route';
import { plannerQuote, placeCountWarning, type PlannerQuote } from '@/lib/planner/pricing';
import { stopsToParam } from '@/lib/planner/share';
import { nominalDayKey, utcDayKey } from '@/lib/services/day-key';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { ChatMsg, Boost } from './types';

const CUSTOM_SLUG = 'custom-road-trip';
const CUSTOM_TITLE = 'Custom Road Trip';

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
  const { pricing } = usePlannerData();

  const [catalog, setCatalog] = useState<Map<string, PlannerPlace>>(new Map());
  const [heroValue, setHeroValue] = useState('');
  const [pickup, setPickup] = useState('belleMare');
  const [stopIds, setStopIds] = useState<string[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState(false);
  const [hasBuilt, setHasBuilt] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [party, setParty] = useState(2);
  const [suv, setSuv] = useState(false);
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
  const pickupObj = useMemo(() => PICKUPS.find((p) => p.id === pickup) ?? PICKUPS[0]!, [pickup]);
  const stops = useMemo(
    () => stopIds.map((id) => catalog.get(id)).filter((p): p is PlannerPlace => Boolean(p)),
    [stopIds, catalog],
  );
  const stopIndex = useMemo(() => new Map(stops.map((p, i) => [p.id, i])), [stops]);
  const route = useMemo(
    () => computePlannerRoute(pickupObj, stops.map((s) => ({ lat: s.lat, lng: s.lng, durationMin: s.durationMin }))),
    [pickupObj, stops],
  );
  // Identifies a day by its *unordered* set of stops + pickup. Auto-optimization reorders the day to
  // the shortest round trip whenever this key changes (a stop added/removed, or the pickup changed);
  // since reordering leaves the key unchanged, the optimizer never re-triggers itself (no loop), and a
  // manual drag-reorder stands until the next change.
  const optimizeKey = useMemo(() => `${pickup}|${[...stopIds].sort().join(',')}`, [pickup, stopIds]);

  let quote: PlannerQuote | null = null;
  let quoteError: string | null = null;
  try {
    quote = plannerQuote(party, suv, pricing);
  } catch {
    quoteError = `Groups over ${pricing.maxParty} — contact us`;
  }

  const presetCards = useMemo<PresetCard[]>(
    () =>
      PRESETS.map((p) => {
        const r = computePlannerRoute(
          pickupObj,
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
    [pickupObj, pricing.standardEur],
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
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/planner/optimize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pickup: { lat: pickupObj.lat, lng: pickupObj.lng },
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
            setStopIds(reordered);
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
  }, [optimizeKey, stops, pickupObj]);

  // ── mount: responsive + dates ──
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 920px)');
    const upd = () => setIsMobile(mq.matches);
    upd();
    mq.addEventListener('change', upd);
    const today = new Date();
    setMinDate(nominalDayKey(today));
    setDate(nominalDayKey(new Date(today.getTime() + 86_400_000)));
    return () => mq.removeEventListener('change', upd);
  }, []);

  // ── mount: deep-link. `?fromTour=slug` hands a sightseeing tour's itinerary to the planner (stops
  //    resolved server-side); `?stops=placeId,placeId&tour=Name` is the shareable form. ──
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const params = new URLSearchParams(window.location.search);

    const fromTour = params.get('fromTour');
    if (fromTour) {
      (async () => {
        try {
          const res = await fetch(`/api/planner/from-tour?slug=${encodeURIComponent(fromTour)}`).then((r) => r.json());
          const tourName: string | null = res.ok ? res.data?.tour ?? null : null;
          const places: PlannerPlace[] = res.ok && Array.isArray(res.data?.places) ? res.data.places : [];
          if (tourName) setBannerTour(tourName.slice(0, 80));
          if (places.length) {
            addToCatalog(places);
            setStopIds(places.map((p) => p.id));
            setHasBuilt(true);
            setChat([
              {
                role: 'assistant',
                kind: 'text',
                text: `You're customizing ${tourName ?? 'this tour'} — I've loaded its stops. Add, drop or reorder anything and I'll keep the route and price live.`,
              },
            ]);
          } else {
            setChat([
              {
                role: 'assistant',
                kind: 'text',
                text: `Let's build on ${tourName ?? 'this tour'}. Tell me what you'd like to see, or browse places and I'll shape the day around them.`,
              },
            ]);
          }
        } catch {
          /* tour resolution failed — start from an empty day */
        }
      })();
      return;
    }

    const raw = (params.get('stops') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const tour = params.get('tour');
    if (tour) setBannerTour(tour.slice(0, 80));
    if (raw.length) {
      (async () => {
        try {
          const res = await fetch(`/api/planner/places?ids=${encodeURIComponent(raw.join(','))}`).then((r) => r.json());
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
                  text: `You're customizing the ${tour.slice(0, 80)} — I've loaded its stops. Add, drop or reorder anything and I'll keep the route and price live.`,
                },
              ]);
            }
          }
        } catch {
          /* deep-link resolution failed — start empty */
        }
      })();
    }
  }, [addToCatalog]);

  // ── shareable URL ──
  useEffect(() => {
    if (!initRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    // The tour hand-off is a one-shot trigger; drop it so the URL settles into the shareable form.
    params.delete('fromTour');
    if (stopIds.length) params.set('stops', stopsToParam(stopIds));
    else params.delete('stops');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [stopIds]);

  // ── stop ops ──
  const addStopId = useCallback((id: string) => {
    setStopIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setHasBuilt(true);
  }, []);
  const addPlace = useCallback(
    (place: PlannerPlace) => {
      addToCatalog([place]);
      addStopId(place.id);
    },
    [addToCatalog, addStopId],
  );
  const removeStop = useCallback((id: string) => setStopIds((prev) => prev.filter((x) => x !== id)), []);
  const moveStop = useCallback((from: number, to: number) => {
    setStopIds((prev) => {
      const a = [...prev];
      const [m] = a.splice(from, 1);
      if (m == null) return prev;
      a.splice(to, 0, m);
      return a;
    });
  }, []);
  const clearTrip = useCallback(() => {
    setStopIds([]);
    setChat([]);
    setBoost(null);
    setHasBuilt(false);
    setTyping(false);
  }, []);

  function applyBoost() {
    if (!boost) return;
    setStopIds((prev) => {
      const i = prev.indexOf(boost.id);
      if (i <= 0) return prev;
      const a = [...prev];
      const [m] = a.splice(i, 1);
      a.splice(1, 0, m!);
      return a;
    });
    setChat((c) => [...c, { role: 'assistant', kind: 'text', text: `Done — I moved ${boost.place} earlier so you arrive well before it closes.` }]);
    setBoost(null);
  }

  // ── chat (real grounded agent over live Google Places) ──
  async function sendChat(text: string) {
    const t = text.trim();
    if (!t) return;
    const history = chat.filter((m): m is Extract<ChatMsg, { kind: 'text' }> => m.kind === 'text').map((m) => ({ role: m.role, content: m.text }));
    setChat((c) => [...c, { role: 'user', kind: 'text', text: t }]);
    setTyping(true);
    setHasBuilt(true);
    try {
      const res = await fetch('/api/ai/trip-planner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [...history, { role: 'user', content: t }].slice(-40) }),
      }).then((r) => r.json());
      setTyping(false);
      if (res.ok) {
        const reply: string = res.data.reply;
        const places: PlannerPlace[] = Array.isArray(res.data.places) ? res.data.places : [];
        const warning: string | null = res.data.warning ?? null;
        if (places.length) {
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
        if (warning) setChat((c) => [...c, { role: 'assistant', kind: 'text', text: warning }]);
      } else {
        setChat((c) => [...c, { role: 'assistant', kind: 'text', text: "Sorry — I couldn't reach the co-pilot just now. Browse places on the left and I'll keep the price live." }]);
      }
    } catch {
      setTyping(false);
      setChat((c) => [...c, { role: 'assistant', kind: 'text', text: 'Something went wrong — please try again in a moment.' }]);
    }
  }

  function scrollToPlanner() {
    const el = document.getElementById('planner');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 60, behavior: 'smooth' });
  }

  function submitHero() {
    const v = heroValue.trim() || 'A relaxed day in the south — two beaches and a waterfall, back by 5pm.';
    scrollToPlanner();
    setMobileTab('chat');
    void sendChat(v);
    setHeroValue('');
  }

  function openPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    addToCatalog(p.places);
    setStopIds(p.places.map((x) => x.id));
    setHasBuilt(true);
    setBannerTour(null);
    setDrawerOpen(false);
    setMobileTab('day');
    setChat([{ role: 'assistant', kind: 'text', text: `Loaded ${p.name} — ${p.places.length} stops on the map. Make it yours: add a beach, drop a stop, or ask me to reshuffle.` }]);
    scrollToPlanner();
  }

  async function bookDay() {
    if (!quote || stops.length === 0 || !date) return;
    setBooking(true);
    setBookError(null);
    try {
      const avail = await fetch(`/api/v1/activities/${CUSTOM_SLUG}/availability?from=${date}&to=${date}`).then((r) => r.json());
      const slots: Array<{ occurrenceId: string; startsAt: string; seatsLeft: number }> = avail.ok ? (avail.data ?? []) : [];
      const slot = slots.find((s) => utcDayKey(s.startsAt) === date) ?? slots[0];
      if (!slot) {
        setBookError("That date isn't open yet — try another day, or contact us to arrange it.");
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
          body: JSON.stringify({ occurrenceId: occ, expectedSlug: CUSTOM_SLUG, people: party, idempotencyKey: idem }),
        }).then((r) => r.json());
        if (res.ok) {
          holdId = res.data.holdId;
          expiresAt = res.data.expiresAt;
        }
      } catch {
        /* checkout creates the hold at pay if this failed */
      }
      try {
        window.sessionStorage.setItem(`gytm:hold:${occ}`, JSON.stringify({ holdId, expiresAt, idem }));
        const itinerary = stops.map((s) => ({ title: s.name, area: s.region, lat: s.lat, lng: s.lng }));
        window.sessionStorage.setItem(`gytm:itinerary:${CUSTOM_SLUG}`, JSON.stringify(itinerary));
      } catch {
        /* sessionStorage unavailable — checkout falls back */
      }
      const dateText = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const q = new URLSearchParams({
        occ,
        label: quote.vehicle,
        qty: String(party),
        slug: CUSTOM_SLUG,
        title: CUSTOM_TITLE,
        lang: 'en',
        total: String(quote.totalEur),
        when: `${dateText}, ${time}`,
        guests: String(party),
        unit: 'per vehicle',
        suv: suv ? '1' : '0',
        childSeats: '0',
        from: 'widget',
      });
      router.push(`/checkout?${q.toString()}`);
    } catch {
      setBookError("We couldn't start your booking just now. Please try again.");
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

  // Real Google map: drive the route through the stops (numbered 1..n). With no stops, show the base.
  const mapStops =
    stops.length > 0
      ? stops.map((s) => ({ title: s.name, lat: s.lat, lng: s.lng }))
      : [{ title: pickupObj.name, lat: pickupObj.lat, lng: pickupObj.lng }];
  const warning = placeCountWarning(stops.length);

  const itinerary = (
    <ItineraryPanel
      stops={stops}
      pickupId={pickup}
      onPickup={setPickup}
      route={route}
      quote={quote}
      onAddPlaces={() => setDrawerOpen(true)}
      onRemove={removeStop}
      onMove={moveStop}
      onQuote={() => setQuoteOpen(true)}
      onShare={copyLink}
      shared={shared}
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
    />
  );
  const map = <RouteMap stops={mapStops} animate={stops.length > 0} carColor="#DC2626" className="h-full w-full" loop={false} />;
  const drawer = <PlacesDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} selectedIds={stopIds} onAdd={addPlace} />;

  return (
    <main className="min-h-screen bg-white">
      <HeroSection value={heroValue} onChange={setHeroValue} onSubmit={submitHero} onChip={(c) => { setHeroValue(c); scrollToPlanner(); setMobileTab('chat'); void sendChat(c); setHeroValue(''); }} />

      <div id="planner" style={{ background: 'linear-gradient(180deg,#FFFFFF, #F6FBFA)' }}>
        {bannerTour && (
          <div className="mx-auto max-w-shell px-[22px] pt-3.5">
            <div className="flex items-center gap-3 rounded-[14px] border border-[#D8ECEA] px-[15px] py-[11px]" style={{ background: 'linear-gradient(120deg,#EAF7F5,#fff)' }}>
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-coral">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 3l2.3 4.7L19.5 8l-3.7 3.6.9 5.1L12 14.5 7.3 16.7l.9-5.1L4.5 8l5.2-.3L12 3Z" fill="#fff" />
                </svg>
              </span>
              <div className="flex-1">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.05em] text-coral">Customizing</span>
                <div className="text-[14.5px] font-bold text-ink">{bannerTour} — make it yours</div>
              </div>
              <button type="button" onClick={() => setBannerTour(null)} aria-label="Dismiss" className="cursor-pointer p-1.5 text-ink-muted">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {isMobile ? (
          <div className="px-3 pt-2.5">
            <div className="relative h-[calc(100vh-220px)] min-h-[460px] overflow-hidden rounded-[18px] border border-[#EAF2F1] bg-white shadow-[0_14px_34px_rgba(10,46,54,.08)]">
              <div className="h-full">{mobileTab === 'chat' ? copilot : mobileTab === 'map' ? map : itinerary}</div>
              {drawer}
            </div>
            <div className="sticky bottom-0 mt-2.5 flex gap-1.5 rounded-[16px] border border-[#EAF2F1] bg-white p-1.5 shadow-[0_10px_24px_rgba(10,46,54,.1)]">
              {([['chat', 'Co-pilot'], ['day', 'Your day'], ['map', 'Map']] as const).map(([k, lab]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMobileTab(k)}
                  className={`flex-1 cursor-pointer rounded-[11px] py-2.5 text-[13px] font-bold ${mobileTab === k ? 'bg-teal-tint text-teal-dark' : 'bg-transparent text-ink-muted'}`}
                >
                  {lab}
                </button>
              ))}
            </div>
            {stops.length > 0 && (
              <div className="sticky bottom-0 mt-2.5 flex items-center gap-3 rounded-[16px] bg-ink px-3.5 py-[11px] shadow-[0_12px_28px_rgba(10,46,54,.28)]">
                <div className="flex-1 text-white">
                  <div className="text-[12.5px] font-bold">{stops.length} stops · {fmtDur(route.totalMinutes)} driving</div>
                  <div className="text-xs text-[#9FD2CD]">~{quote ? `€${quote.totalEur}` : '—'} estimate</div>
                </div>
                <button type="button" onClick={() => setQuoteOpen(true)} className="cursor-pointer rounded-xl bg-coral px-[18px] py-[11px] text-sm font-extrabold text-white">
                  Get quote
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-shell px-[22px] pb-2 pt-[18px]">
            <div className="grid h-[min(720px,80vh)] gap-4" style={{ gridTemplateColumns: '330px 1fr 0.86fr' }}>
              <div className="overflow-hidden rounded-[18px] border border-[#EAF2F1] shadow-[0_18px_44px_rgba(10,46,54,.07)]">{itinerary}</div>
              <div className="relative overflow-hidden rounded-[18px] border border-[#EAF2F1] shadow-[0_18px_44px_rgba(10,46,54,.08)]">
                {copilot}
                {drawer}
              </div>
              <div className="overflow-hidden rounded-[18px] border border-[#EAF2F1] shadow-[0_18px_44px_rgba(10,46,54,.07)]">{map}</div>
            </div>
          </div>
        )}

        {warning && (
          <div className="mx-auto max-w-shell px-[22px] pb-1 pt-3">
            <p className="flex items-start gap-2 rounded-[12px] bg-gold/15 px-3 py-2 text-sm text-ink">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0" aria-hidden>
                <path d="M12 9v4m0 3h.01M10.3 4l-7 12a2 2 0 0 0 1.7 3h14a2 2 0 0 0 1.7-3l-7-12a2 2 0 0 0-3.4 0Z" stroke="#C98A12" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {warning}
            </p>
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
        date={date}
        setDate={setDate}
        minDate={minDate}
        time={time}
        setTime={setTime}
        party={party}
        setParty={setParty}
        suv={suv}
        setSuv={setSuv}
        booking={booking}
        bookError={bookError}
        onBook={bookDay}
      />
    </main>
  );
}
