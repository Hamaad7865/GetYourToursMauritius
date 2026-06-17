'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RouteMap } from '@/components/maps/RouteMap';
import { ChatCopilot, type ChatMessage } from './ChatCopilot';
import { PlacesDrawer } from './PlacesDrawer';
import { ItineraryPanel } from './ItineraryPanel';
import { BookingBar } from './BookingBar';
import { usePlannerData } from './usePlannerData';
import { plannerQuote, placeCountWarning, type PlannerQuote } from '@/lib/planner/pricing';
import { parseStopsParam, stopsToParam } from '@/lib/planner/share';
import { haversineLegs } from '@/lib/maps/haversine';
import { nominalDayKey, utcDayKey } from '@/lib/services/day-key';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { ItineraryStop } from '@/lib/validation/tours';

/** The hidden, vehicle_custom activity that every planner booking lands on. */
const CUSTOM_SLUG = 'custom-road-trip';
const CUSTOM_TITLE = 'Custom Road Trip';

/**
 * The AI Road Trip Planner — a single client island wiring the curated places, the grounded co-pilot,
 * the live map + price, and a real booking. State of record is the ordered `stopIds`; everything else
 * (route, drive time, price, share URL) derives from it. The booking re-prices + re-times server-side,
 * so the page can stay optimistic without ever being authoritative about money or availability.
 */
export function PlannerShell() {
  const router = useRouter();
  const { places, pricing, loading, error } = usePlannerData();
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  const [stopIds, setStopIds] = useState<string[]>([]);
  const [party, setParty] = useState(2);
  const [suv, setSuv] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tourName, setTourName] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [minDate, setMinDate] = useState('');
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const initRef = useRef(false);

  // --- Derived state (the single source is stopIds) ---
  const stops = useMemo(
    () => stopIds.map((id) => byId.get(id)).filter((p): p is PlannerPlace => Boolean(p)),
    [stopIds, byId],
  );
  const legs = useMemo(() => haversineLegs(stops.map((s) => ({ lat: s.lat, lng: s.lng }))), [stops]);
  const totalDriveMin = legs.reduce((a, l) => a + l.minutes, 0);
  const totalVisitMin = stops.reduce((a, s) => a + s.durationMin, 0);
  const warning = placeCountWarning(stops.length);
  const mapStops: ItineraryStop[] = stops.map((s) => ({
    title: s.name,
    area: s.region,
    lat: s.lat,
    lng: s.lng,
  }));

  let quote: PlannerQuote | null = null;
  let quoteError: string | null = null;
  try {
    quote = plannerQuote(party, suv, pricing);
  } catch {
    quoteError = `For groups over ${pricing.maxParty}, contact us for a custom quote.`;
  }

  // --- Mount: default dates + deep-link prefill (?stops=a,b,c&tour=Name), once data is ready ---
  useEffect(() => {
    if (initRef.current || loading) return;
    initRef.current = true;
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    setMinDate(nominalDayKey(today));
    setDate(nominalDayKey(tomorrow));
    if (places.length) {
      const params = new URLSearchParams(window.location.search);
      const ids = parseStopsParam(
        params.get('stops'),
        places.map((p) => p.id),
      );
      if (ids.length) setStopIds(ids);
      const t = params.get('tour');
      if (t) setTourName(t.slice(0, 80));
    }
  }, [loading, places]);

  // --- Keep the URL shareable: reflect the current stops without a navigation ---
  useEffect(() => {
    if (!initRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (stopIds.length) params.set('stops', stopsToParam(stopIds));
    else params.delete('stops');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [stopIds]);

  const addStop = useCallback(
    (id: string) => setStopIds((prev) => (prev.includes(id) ? prev : [...prev, id])),
    [],
  );
  const removeStop = useCallback((id: string) => setStopIds((prev) => prev.filter((x) => x !== id)), []);
  const moveStop = useCallback(
    (index: number, dir: -1 | 1) =>
      setStopIds((prev) => {
        const j = index + dir;
        if (j < 0 || j >= prev.length) return prev;
        const next = [...prev];
        [next[index], next[j]] = [next[j]!, next[index]!];
        return next;
      }),
    [],
  );
  const clearDay = useCallback(() => setStopIds([]), []);

  // --- Chat: append, send the running conversation, apply the AI's chosen itinerary to the map ---
  async function sendChat(text: string) {
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setChatBusy(true);
    try {
      const res = await fetch('/api/ai/trip-planner', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(-40) }),
      }).then((r) => r.json());
      if (res.ok) {
        const reply: string = res.data.reply;
        const placeIds: string[] = Array.isArray(res.data.placeIds) ? res.data.placeIds : [];
        setMessages((m) => [...m, { role: 'assistant', content: reply }]);
        const valid = placeIds.filter((id) => byId.has(id));
        if (valid.length) setStopIds(valid);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content:
              "Sorry — I couldn't reach the planner just now. You can still browse places and build your day below.",
          },
        ]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'Something went wrong. Please try again in a moment.' },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  // --- Book: find the occurrence for the date, hold it, stash the itinerary, hand off to checkout ---
  async function bookDay() {
    if (!quote || stops.length === 0 || !date) return;
    setBooking(true);
    setBookError(null);
    try {
      const avail = await fetch(
        `/api/v1/activities/${CUSTOM_SLUG}/availability?from=${date}&to=${date}`,
      ).then((r) => r.json());
      const slots: Array<{ occurrenceId: string; startsAt: string; seatsLeft: number }> = avail.ok
        ? (avail.data ?? [])
        : [];
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
        window.sessionStorage.setItem(`gytm:hold:${occ}`, JSON.stringify({ holdId, expiresAt, idem }));
        const itinerary = stops.map((s) => ({ title: s.name, area: s.region, lat: s.lat, lng: s.lng }));
        window.sessionStorage.setItem(`gytm:itinerary:${CUSTOM_SLUG}`, JSON.stringify(itinerary));
      } catch {
        /* sessionStorage unavailable — checkout falls back */
      }

      const dateText = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
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
        total: String(quote.totalEur),
        when: dateText,
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
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the URL bar already reflects the day */
    }
  }

  return (
    <main className="min-h-screen bg-cream">
      {/* Hero */}
      <section className="bg-gradient-to-br from-teal to-teal-dark text-white">
        <div className="mx-auto max-w-shell px-4 py-10 sm:py-12">
          {tourName && (
            <span className="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
              Planning from “{tourName}”
            </span>
          )}
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">AI Road Trip Planner</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/85 sm:text-base">
            Describe the day you want. Our local co-pilot builds a real route across Mauritius —
            grounded in actual places and drive times — and prices it instantly with one flat fare per
            vehicle. Book in a tap.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-shell px-4 py-8">
        {loading ? (
          <div className="grid place-items-center rounded-card border border-ink/10 bg-white py-24 text-ink-muted">
            Loading the planner…
          </div>
        ) : error ? (
          <div className="rounded-card border border-ink/10 bg-white p-8 text-center">
            <p className="font-display text-lg text-ink">We couldn&apos;t load the planner right now.</p>
            <p className="mt-1 text-sm text-ink-muted">Please refresh the page, or try again shortly.</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* The day */}
            <div className="space-y-6 lg:col-span-7">
              {mapStops.length > 0 ? (
                <RouteMap stops={mapStops} animate />
              ) : (
                <div className="grid h-[300px] w-full place-items-center rounded-2xl border border-dashed border-ink/15 bg-white text-center text-sm text-ink-muted lg:h-[360px]">
                  Your route map appears here as you add places.
                </div>
              )}
              <ItineraryPanel
                stops={stops}
                legs={legs}
                warning={warning}
                totalDriveMin={totalDriveMin}
                totalVisitMin={totalVisitMin}
                onRemove={removeStop}
                onMove={moveStop}
                onOpenDrawer={() => setDrawerOpen(true)}
                onClear={clearDay}
              />
              <BookingBar
                party={party}
                setParty={setParty}
                suv={suv}
                setSuv={setSuv}
                quote={quote}
                quoteError={quoteError}
                maxParty={pricing.maxParty}
                date={date}
                setDate={setDate}
                minDate={minDate}
                booking={booking}
                bookError={bookError}
                canBook={stops.length > 0}
                onBook={bookDay}
              />
              {stops.length > 0 && (
                <button
                  type="button"
                  onClick={copyLink}
                  className="text-sm font-medium text-teal underline-offset-2 hover:underline"
                >
                  {copied ? '✓ Link copied' : 'Copy a shareable link to this day'}
                </button>
              )}
            </div>

            {/* Co-pilot */}
            <div className="lg:col-span-5">
              <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
                <ChatCopilot messages={messages} busy={chatBusy} onSend={sendChat} />
              </div>
            </div>
          </div>
        )}
      </div>

      <PlacesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        places={places}
        selectedIds={stopIds}
        onAdd={addStop}
        onRemove={removeStop}
      />
    </main>
  );
}
