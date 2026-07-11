'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { IconBoat, IconCar, IconFlag, IconPin, IconWalk } from '@/components/ui/icons';

export type StopVariant = 'pickup' | 'main' | 'other';

export interface TimelineNode {
  title: string;
  area?: string | null;
  /** What happens at the stop — rendered muted under the title (GYG-style, e.g. "Sightseeing (20 minutes)"). */
  description?: string | null;
  tags?: string[];
  /** Marker style: coral pickup, solid "main" stop, or hollow swappable "other" stop. */
  variant?: StopVariant;
  /** Optional control rendered under the node (e.g. a "Change" button for swappable stops). */
  action?: React.ReactNode;
}

type Glyph = 'car' | 'boat' | 'walk' | 'pin';

/** Infer the medallion glyph from the stop's own words: transport legs ("Speedboat (20 min)",
 *  "Car transfer") get their vehicle, walks get the walker, everything else is a place pin. */
function glyphFor(title: string): Glyph {
  const s = title.toLowerCase();
  if (/\b(car|taxi|van|minibus|bus|drive|driving|transfer|voiture)\b/.test(s)) return 'car';
  if (/\b(speed ?boat|boat|catamaran|ferry|cruise|kayak|bateau|croisi[eè]re)\b/.test(s)) return 'boat';
  if (/\b(walk|walking|hike|hiking|trek|trekking|marche|randonn[eé]e)\b/.test(s)) return 'walk';
  return 'pin';
}

const GLYPHS: Record<Glyph, (p: React.SVGProps<SVGSVGElement>) => React.ReactNode> = {
  car: IconCar,
  boat: IconBoat,
  walk: IconWalk,
  pin: IconPin,
};

/** GYG-style circular medallion: filled coral start node, white ringed circles for stops
 *  (dark pin or an inferred transport glyph), dashed teal ring for swappable "other" stops. */
function NodeBadge({ variant, title }: { variant: StopVariant; title: string }) {
  if (variant === 'pickup') {
    return (
      <span className="gyt-itin-badge relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral text-white shadow-[0_8px_16px_-8px_rgba(247,108,94,0.9)]">
        <IconFlag width={17} height={17} />
      </span>
    );
  }
  const Icon = GLYPHS[glyphFor(title)];
  if (variant === 'other') {
    return (
      <span className="gyt-itin-badge relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-dashed border-teal bg-white text-teal">
        <Icon width={17} height={17} />
      </span>
    );
  }
  return (
    <span className="gyt-itin-badge relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full border border-ink/15 bg-white text-ink/75 shadow-[0_5px_12px_-8px_rgba(10,46,54,0.5)]">
      <Icon width={17} height={17} />
    </span>
  );
}

/** Itinerary timeline that collapses to the first `collapseAt` stops with a
 *  "View full itinerary" toggle when there are more than three locations. */
export function ItineraryTimeline({
  nodes,
  collapseAt = 4,
}: {
  nodes: TimelineNode[];
  collapseAt?: number;
}) {
  const collapsible = nodes.length > collapseAt;
  const [expanded, setExpanded] = useState(false);
  const visible = collapsible && !expanded ? nodes.slice(0, collapseAt) : nodes;
  const hidden = nodes.length - visible.length;

  // Scroll-reveal: once the list scrolls into view, each stop rises in with a small stagger.
  // `armed` only flips when JS is live AND motion is allowed, so SSR/no-JS/reduced-motion render
  // the plain, fully visible list (no flash, nothing hidden).
  const listRef = useRef<HTMLOListElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = listRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    setArmed(true);
    // A healthy observer ALWAYS delivers an initial callback right after observe(). If none arrives
    // (zero-height embeds, broken IO), the watchdog force-reveals — the animation is decorative and
    // must never be able to leave the content hidden.
    let sawCallback = false;
    const io = new IntersectionObserver(
      (entries) => {
        sawCallback = true;
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    const watchdog = setTimeout(() => {
      if (!sawCallback) setRevealed(true);
    }, 1200);
    return () => {
      io.disconnect();
      clearTimeout(watchdog);
    };
  }, []);

  return (
    <div>
      <ol ref={listRef} className="relative m-0 list-none p-0">
        {visible.map((stop, i) => (
          // Index key (the list is fixed-length, never reordered) so a node keeps its identity when
          // its chosen title changes — preserving the chooser's focus/refs across a swap.
          <li
            key={i}
            className={`relative flex gap-3.5 pb-7 last:pb-0 ${armed && !revealed ? 'opacity-0' : ''} ${
              revealed ? 'gyt-itin-in' : ''
            }`}
            style={{ '--itin-d': `${Math.min(i, 8) * 90}ms` } as CSSProperties}
          >
            {i < visible.length - 1 && (
              // Dotted route thread (GYG-style): a column of coral dots from this medallion to the next.
              <span
                aria-hidden
                className="absolute bottom-1 left-4 top-[42px] w-1"
                style={{
                  backgroundImage: 'radial-gradient(circle, #F76C5E 1.6px, transparent 1.7px)',
                  backgroundSize: '4px 9px',
                  backgroundPosition: 'top center',
                  backgroundRepeat: 'repeat-y',
                }}
              />
            )}
            <NodeBadge variant={stop.variant ?? 'main'} title={stop.title} />
            <div className="min-w-0 flex-1 pt-1.5">
              <div className="text-[15px] font-bold leading-snug text-ink">{stop.title}</div>
              {stop.area && <div className="mt-0.5 text-[13px] text-ink-muted">{stop.area}</div>}
              {stop.description && (
                <div className="mt-0.5 text-[13.5px] leading-snug text-ink/70">{stop.description}</div>
              )}
              {stop.tags && stop.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {stop.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-teal/[0.08] px-2 py-0.5 text-[11.5px] font-semibold text-teal"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {stop.action}
            </div>
          </li>
        ))}
      </ol>
      {collapsible && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-sm font-bold text-teal underline underline-offset-2 hover:text-teal-dark"
        >
          {expanded ? 'Show less' : `View full itinerary (${hidden} more)`}
        </button>
      )}
    </div>
  );
}
