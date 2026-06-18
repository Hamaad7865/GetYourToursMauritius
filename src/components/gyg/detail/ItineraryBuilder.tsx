'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import type { StopKind } from '@/components/maps/RouteMap';
import { chosenRoute, divergesFromDefault, placeForStop } from '@/lib/itinerary/route';
import { ItineraryTimeline, type TimelineNode } from './ItineraryTimeline';
import { ItineraryMap } from '@/components/maps/ItineraryMap';
import { IconSwap } from '@/components/ui/icons';
import { useT } from '@/components/site/PreferencesProvider';

interface Choice {
  title: string;
  area: string | null;
}

/**
 * "Change" button + radiogroup chooser for one swappable stop. Self-contained so it can manage its
 * own focus: opening moves focus to the selected option; closing (Escape / selection) returns focus
 * to the trigger. The parent owns `open` so only one chooser is open at a time.
 */
function StopChooser({
  id,
  stopTitle,
  choices,
  selected,
  open,
  onToggle,
  onSelect,
}: {
  id: string;
  stopTitle: string;
  choices: Choice[];
  selected: number;
  open: boolean;
  onToggle: () => void;
  onSelect: (index: number) => void;
}) {
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      const el =
        groupRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
        groupRef.current?.querySelector<HTMLElement>('[role="radio"]');
      el?.focus();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      // Returned to closed after being open → restore focus to the trigger.
      triggerRef.current?.focus();
      wasOpen.current = false;
    }
  }, [open]);

  return (
    <div className="relative mt-2" data-itinerary-chooser>
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex items-center gap-1.5 rounded-full border border-teal/40 bg-white px-3 py-1 text-[12.5px] font-bold text-teal-dark hover:border-teal hover:bg-teal/5"
      >
        <IconSwap width={14} height={14} /> {t('Change')}
      </button>
      {open && (
        <div
          ref={groupRef}
          id={id}
          role="radiogroup"
          aria-label={t('Choose a place for {stop}', { stop: stopTitle })}
          className="absolute left-0 top-[calc(100%+6px)] z-20 w-64 max-w-[78vw] rounded-xl border border-ink/12 bg-white p-1.5 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]"
        >
          {choices.map((c, ci) => {
            const active = selected === ci;
            return (
              <button
                key={ci}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(ci)}
                className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-cream"
              >
                <span
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${
                    active ? 'border-teal' : 'border-ink/25'
                  }`}
                  aria-hidden
                >
                  {active && <span className="h-2 w-2 rounded-full bg-teal" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-ink">{c.title}</span>
                  {c.area && <span className="block text-[12px] text-ink-muted">{c.area}</span>}
                </span>
                {ci === 0 && (
                  <span className="ml-1 shrink-0 self-center text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">
                    {t('Default')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Customisable itinerary. Same timeline + map as the read-only itinerary (so they look identical),
 * but stops that have alternatives render as hollow "other" pins with a "Change" chooser. The
 * customer picks ONE place per stop (no add/remove/reorder). The chosen route is stashed in
 * sessionStorage (`gytm:itinerary:<slug>`) for checkout — only when it diverges from all primaries.
 * Pickup is read-only here (the meeting point); the customer's pickup is taken at checkout.
 */
export function ItineraryBuilder({
  slug,
  stops,
  meetingPoint,
}: {
  slug: string;
  stops: ItineraryStop[];
  meetingPoint?: string | null;
}) {
  const t = useT();
  // selectedByStop[i] = 0 (primary) | 1.. (options[n-1]).
  const [selectedByStop, setSelectedByStop] = useState<Record<number, number>>({});
  const [openStop, setOpenStop] = useState<number | null>(null);

  const route = useMemo(() => chosenRoute(stops, selectedByStop), [stops, selectedByStop]);

  // Stash only when the customer actually swapped something (else null = standard route).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `gytm:itinerary:${slug}`;
    if (divergesFromDefault(selectedByStop)) {
      window.sessionStorage.setItem(key, JSON.stringify(route));
    } else {
      window.sessionStorage.removeItem(key);
    }
  }, [slug, selectedByStop, route]);

  // Close the open chooser on a click outside ANY chooser (the map, other stops, the caption) or Escape.
  useEffect(() => {
    if (openStop === null) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-itinerary-chooser]')) setOpenStop(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenStop(null);
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [openStop]);

  // Map markers are fixed per tour (start + main/other by whether a stop is swappable); only the
  // chosen places move, so debounce the stops fed to the map (not the kinds).
  const mapKinds: StopKind[] = useMemo(
    () => [
      ...(meetingPoint ? (['start'] as StopKind[]) : []),
      ...stops.map((s): StopKind => ((s.options?.length ?? 0) > 0 ? 'other' : 'main')),
    ],
    [meetingPoint, stops],
  );
  const mapStops: ItineraryStop[] = useMemo(
    () => [
      ...(meetingPoint ? [{ title: meetingPoint } as ItineraryStop] : []),
      ...route.map((p) => ({ title: p.title, area: p.area, lat: p.lat, lng: p.lng })),
    ],
    [meetingPoint, route],
  );
  const [mapStopsDebounced, setMapStopsDebounced] = useState(mapStops);
  useEffect(() => {
    const t = setTimeout(() => setMapStopsDebounced(mapStops), 500);
    return () => clearTimeout(t);
  }, [mapStops]);

  // Timeline nodes: read-only pickup + each stop's chosen place, with a "Change" chooser on
  // stops that have alternatives.
  const nodes: TimelineNode[] = [
    ...(meetingPoint
      ? [{ title: t('Pickup location'), area: meetingPoint, variant: 'pickup' as const }]
      : []),
    ...stops.map((stop, i): TimelineNode => {
      const sel = selectedByStop[i] ?? 0;
      const chosen = placeForStop(stop, sel);
      const hasOptions = (stop.options?.length ?? 0) > 0;
      const choices: Choice[] = [
        { title: stop.title, area: stop.area ?? null },
        ...(stop.options ?? []).map((o) => ({ title: o.title, area: o.area ?? null })),
      ];
      return {
        title: chosen.title,
        area: chosen.area,
        tags: stop.tags,
        variant: hasOptions ? 'other' : 'main',
        action: hasOptions ? (
          <StopChooser
            id={`itinerary-chooser-${i}`}
            stopTitle={stop.title}
            choices={choices}
            selected={sel}
            open={openStop === i}
            onToggle={() => setOpenStop((s) => (s === i ? null : i))}
            onSelect={(ci) => {
              setSelectedByStop((m) => ({ ...m, [i]: ci }));
              setOpenStop(null);
            }}
          />
        ) : undefined,
      };
    }),
  ];

  // Never collapse a swappable stop out of view — its "Change" button must be reachable by default
  // (otherwise the customisation, and the caption below, would be invisible on load).
  const lastActionNode = nodes.reduce((max, n, idx) => (n.action ? idx : max), -1);
  const collapseAt = Math.max(meetingPoint ? 4 : 3, lastActionNode + 1);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <ItineraryTimeline nodes={nodes} collapseAt={collapseAt} />
        <p className="mt-3 text-[12px] text-ink-muted">
          {t('Stops with a')} <span className="font-semibold text-teal-dark">{t('Change')}</span>{' '}
          {t('button can be swapped — pick the places you want at no extra cost. Your driver follows your choices.')}
        </p>
      </div>
      <ItineraryMap stops={mapStopsDebounced} kinds={mapKinds} />
    </div>
  );
}
