'use client';

import { useState } from 'react';

export interface TimelineNode {
  title: string;
  area?: string | null;
  tags?: string[];
  pickup?: boolean;
}

/** Itinerary timeline that collapses to the first `collapseAt` stops with a
 *  "Show full itinerary" toggle when there are more than three locations. */
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
          <li key={`${stop.title}-${i}`} className="relative flex gap-4 pb-6 last:pb-0">
            {i < visible.length - 1 && (
              <span className="absolute left-[7px] top-6 h-full w-0.5 bg-teal/25" aria-hidden />
            )}
            <span
              className={`z-[1] mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border-[3px] ${
                stop.pickup ? 'border-coral bg-coral' : 'border-teal bg-white'
              }`}
              aria-hidden
            />
            <div className="min-w-0">
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
          {expanded ? 'Show less' : `Show full itinerary (${hidden} more)`}
        </button>
      )}
    </div>
  );
}
