'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlannerData } from './usePlannerData';
import { HeroSection } from './HeroSection';
import { ItineraryPanel } from './ItineraryPanel';
import { ChatCopilot } from './ChatCopilot';
import { PlacesDrawer } from './PlacesDrawer';
import { QuoteModal } from './QuoteModal';
import { MauritiusMap } from './MauritiusMap';
import { PresetsSection, type PresetCard } from './PresetsSection';
import { FeaturesSection } from './FeaturesSection';
import { TrustSection } from './TrustSection';
import { FaqSection } from './FaqSection';
import { PICKUPS, PRESETS, fmtDur } from './planner-constants';
import { computePlannerRoute } from '@/lib/planner/route';
import { plannerQuote, placeCountWarning, type PlannerQuote } from '@/lib/planner/pricing';
import { parseStopsParam, stopsToParam } from '@/lib/planner/share';
import { nominalDayKey, utcDayKey } from '@/lib/services/day-key';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { ChatMsg, Boost } from './types';

const CUSTOM_SLUG = 'custom-road-trip';
const CUSTOM_TITLE = 'Custom Road Trip';

/**
 * AI Road Trip Planner — the full design-handoff experience wired to real data. `stopIds` + `pickup`
 * are the source of truth; route, drive times, price and the share URL derive from them. The co-pilot
 * is the real grounded agent; the map is the stylized SVG island; "Get my quote" runs the live
 * availability → hold → /checkout booking. Marketing sections (presets/features/trust/FAQ) frame it.
 */
export function PlannerShell() {
  const router = useRouter();
  const { places, pricing, error } = usePlannerData();
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

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
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [routeKey, setRouteKey] = useState(0);
  const [shared, setShared] = useState(false);
  const initRef = useRef(false);

  // ── derived ──
  const pickupObj = useMemo(() => PICKUPS.find((p) => p.id === pickup) ?? PICKUPS[0]!, [pickup]);
  const stops = useMemo(
    () => stopIds.map((id) => byId.get(id)).filter((p): p is PlannerPlace => Boolean(p)),
    [stopIds, byId],
  );
  const stopIndex = useMemo(() => new Map(stops.map((p, i) => [p.id, i])), [stops]);
  const route = useMemo(
    () => computePlannerRoute(pickupObj, stops.map((s) => ({ lat: s.lat, lng: s.lng, durationMin: s.durationMin }))),
    [pickupObj, stops],
  );
  const segMinutes = useMemo(() => route.segs.map((s) => s.minutes), [route]);

  let quote: PlannerQuote | null = null;
  let quoteError: string | null = null;
  try {
    quote = plannerQuote(party, suv, pricing);
  } catch {
    quoteError = `Groups over ${pricing.maxParty} — contact us`;
  }

  const presetCards = useMemo<PresetCard[]>(() => {
    return PRESETS.map((p) => {
      const ids = p.stops.filter((s) => byId.has(s));
      if (!ids.length) return null;
      const r = computePlannerRoute(
        pickupObj,
        ids.map((id) => {
          const x = byId.get(id)!;
          return { lat: x.lat, lng: x.lng, durationMin: x.durationMin };
        }),
      );
      return {
        id: p.id,
        name: p.name,
        grad: p.grad,
        stopCount: ids.length,
        hoursLabel: `~${Math.max(1, Math.round((r.totalMinutes + r.visitMinutes) / 60))}h`,
        fromEur: pricing.standardEur,
      };
    }).filter((x): x is PresetCard => x !== null);
  }, [byId, pickupObj, pricing.standardEur]);

  // ── opening-hours boost: a stop that closes early sitting too late in the order ──
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

  // ── mount: responsive + dates + deep-link ──
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

  useEffect(() => {
    if (initRef.current || places.length === 0) return;
    initRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const ids = parseStopsParam(params.get('stops'), places.map((p) => p.id));
    const tour = params.get('tour');
    if (ids.length) {
      setStopIds(ids);
      setHasBuilt(true);
      setRouteKey((k) => k + 1);
      if (tour) {
        setBannerTour(tour.slice(0, 80));
        setChat([
          {
            role: 'assistant',
            kind: 'text',
            text: `You're customizing the ${tour.slice(0, 80)} — I've loaded its stops. Add, drop or reorder anything and I'll keep the route and price live.`,
          },
        ]);
      }
    }
  }, [places]);

  // ── shareable URL ──
  useEffect(() => {
    if (!initRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (stopIds.length) params.set('stops', stopsToParam(stopIds));
    else params.delete('stops');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [stopIds]);

  // ── stop ops ──
  const addStop = useCallback(
    (id: string) =>
      setStopIds((prev) => {
        if (prev.includes(id)) return prev;
        setLastAdded(id);
        setHasBuilt(true);
        setRouteKey((k) => k + 1);
        return [...prev, id];
      }),
    [],
  );
  const removeStop = useCallback((id: string) => {
    setStopIds((prev) => prev.filter((x) => x !== id));
    setRouteKey((k) => k + 1);
  }, []);
  const moveStop = useCallback((from: number, to: number) => {
    setStopIds((prev) => {
      const a = [...prev];
      const [m] = a.splice(from, 1);
      if (m == null) return prev;
      a.splice(to, 0, m);
      return a;
    });
    setRouteKey((k) => k + 1);
  }, []);
  const clearTrip = useCallback(() => {
    setStopIds([]);
    setChat([]);
    setBoost(null);
    setHasBuilt(false);
    setTyping(false);
    setRouteKey((k) => k + 1);
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
    setRouteKey((k) => k + 1);
    setChat((c) => [...c, { role: 'assistant', kind: 'text', text: `Done — I moved ${boost.place} earlier so you arrive well before it closes.` }]);
    setBoost(null);
  }

  // ── chat (real grounded agent) ──
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
        const ids: string[] = (Array.isArray(res.data.placeIds) ? res.data.placeIds : []).filter((id: string) => byId.has(id));
        const warning: string | null = res.data.warning ?? null;
        if (ids.length) {
          const newOnes = ids.filter((id) => !stopIds.includes(id));
          setStopIds(ids);
          setLastAdded(ids[ids.length - 1] ?? null);
          setRouteKey((k) => k + 1);
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
    const ids = p.stops.filter((s) => byId.has(s));
    if (!ids.length) return;
    setStopIds(ids);
    setHasBuilt(true);
    setBannerTour(null);
    setDrawerOpen(false);
    setLastAdded(ids[ids.length - 1] ?? null);
    setRouteKey((k) => k + 1);
    setChat([{ role: 'assistant', kind: 'text', text: `Loaded ${p.name} — ${ids.length} stops on the map. Make it yours: add a beach, drop a stop, or ask me to reshuffle.` }]);
    setMobileTab('day');
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

  const mapStops = stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng }));
  const warning = placeCountWarning(stops.length);

  const itinerary = (
    <ItineraryPanel
      stops={stops}
      pickupId={pickup}
      onPickup={(id) => {
        setPickup(id);
        setRouteKey((k) => k + 1);
      }}
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
      placesById={byId}
      stopIndex={stopIndex}
      route={route}
      quote={quote}
      onSend={sendChat}
      onApplyBoost={applyBoost}
      onDismissBoost={() => setBoost(null)}
      onClear={clearTrip}
      onBrowse={() => setDrawerOpen(true)}
      onQuote={() => setQuoteOpen(true)}
      onAddPlace={addStop}
    />
  );
  const map = <MauritiusMap pickup={pickupObj} stops={mapStops} segMinutes={segMinutes} lastAdded={lastAdded} routeKey={routeKey} />;
  const drawer = (
    <PlacesDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} places={places} selectedIds={stopIds} onAdd={addStop} />
  );

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

        {error && (
          <div className="mx-auto max-w-shell px-[22px] pt-3.5">
            <p className="rounded-[14px] border border-[#F3DCA6] bg-[#FFF8EC] px-[15px] py-2.5 text-[13px] text-[#7A5A12]">
              Live place data isn&apos;t loading right now — the co-pilot still works, and you can try again shortly.
            </p>
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
