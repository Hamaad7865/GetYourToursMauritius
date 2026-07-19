'use client';

import type { TripDayPlan } from '@/lib/planner/trip';
import { useT } from '@/components/site/PreferencesProvider';

function tabDate(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? dayKey
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Range mode's day switcher — one tab per trip date (Day 1 · Mon 1 Sep …), a planned/empty dot per
 * day, and an exit back to the single-day planner. Rendered above the planner panes so the active
 * day drives the itinerary panel, the chat context and the map together.
 */
export function DayTabs({
  days,
  activeIdx,
  onSelect,
  onExit,
}: {
  days: TripDayPlan[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  /** Leave range mode (keeps the active day's stops as the single day). */
  onExit: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <div
        role="tablist"
        aria-label={t('Trip days')}
        className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto rounded-[14px] border border-[#EAF2F1] bg-white p-1.5 shadow-[0_6px_18px_rgba(10,46,54,.06)]"
      >
        {days.map((d, i) => {
          const active = i === activeIdx;
          const planned = d.stopIds.length > 0 || d.activitySlug != null;
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(i)}
              className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px] font-bold transition ${
                active ? 'bg-teal-tint text-teal-dark' : 'text-ink-muted hover:bg-[#F4F8F7]'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${planned ? 'bg-teal' : 'border border-[#B7C6C8]'}`}
                aria-hidden
              />
              <span className="whitespace-nowrap">
                {t('Day {n}', { n: i + 1 })}
                <span className={`ml-1.5 font-semibold ${active ? 'text-teal-dark/80' : ''}`}>
                  {tabDate(d.date)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onExit}
        className="shrink-0 cursor-pointer rounded-[10px] border border-[#EAF2F1] bg-white px-3 py-2.5 text-[12px] font-bold text-ink-muted shadow-[0_6px_18px_rgba(10,46,54,.06)] hover:text-teal-dark"
      >
        {t('Single day')}
      </button>
    </div>
  );
}
