'use client';

import { useState } from 'react';

export type StopVariant = 'pickup' | 'main' | 'other';

export interface TimelineNode {
  title: string;
  area?: string | null;
  tags?: string[];
  /** Marker style: coral pickup, solid "main" stop, or hollow swappable "other" stop. */
  variant?: StopVariant;
  /** Optional control rendered under the node (e.g. a "Change" button for swappable stops). */
  action?: React.ReactNode;
}

/** Brand teardrop marker matching the map pins: coral pickup, solid teal main, hollow teal other. */
function StopMarker({ variant }: { variant: StopVariant }) {
  const color = variant === 'pickup' ? '#F76C5E' : '#0E8C92';
  if (variant === 'other') {
    return (
      <svg width="18" height="23" viewBox="0 0 30 38" className="mt-0.5 shrink-0" aria-hidden>
        <path
          d="M15 1.2C7.4 1.2 1.2 7.4 1.2 15c0 9.4 13.8 22 13.8 22s13.8-12.6 13.8-22C28.8 7.4 22.6 1.2 15 1.2z"
          fill="#fff"
          stroke={color}
          strokeWidth="2.4"
        />
        <circle cx="15" cy="15" r="5.5" fill={color} />
      </svg>
    );
  }
  return (
    <svg width="18" height="23" viewBox="0 0 30 38" className="mt-0.5 shrink-0" aria-hidden>
      <path
        d="M15 0C6.7 0 0 6.7 0 15c0 9.7 15 23 15 23s15-13.3 15-23C30 6.7 23.3 0 15 0z"
        fill={color}
      />
      <circle cx="15" cy="15" r="6" fill="#fff" />
    </svg>
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

  return (
    <div>
      <ol className="relative m-0 list-none p-0">
        {visible.map((stop, i) => (
          // Index key (the list is fixed-length, never reordered) so a node keeps its identity when
          // its chosen title changes — preserving the chooser's focus/refs across a swap.
          <li key={i} className="relative flex gap-3.5 pb-6 last:pb-0">
            {i < visible.length - 1 && (
              <span className="absolute left-[8px] top-[22px] h-full w-0.5 bg-teal/25" aria-hidden />
            )}
            <StopMarker variant={stop.variant ?? 'main'} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold text-ink">{stop.title}</div>
              {stop.area && <div className="text-[13px] text-ink-muted">{stop.area}</div>}
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
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-sm font-bold text-teal underline underline-offset-2 hover:text-teal-dark"
        >
          {expanded ? 'Show less' : `View full itinerary (${hidden} more)`}
        </button>
      )}
    </div>
  );
}
