'use client';

import { sectionCount, type SectionId, type SectionMeta } from './sections';
import type { ActivityFormValues } from '@/lib/admin/activity-write';

/**
 * The tour editor's pane switcher: a sticky column on desktop, a horizontal strip on mobile.
 *
 * Deliberately not a snap rail — a plain `overflow-x-auto` strip, so it stays clear of the
 * mandatory-snap gutter trap the guard test watches for.
 */
export function SectionRail({
  sections,
  active,
  onSelect,
  values,
  issues,
}: {
  sections: SectionMeta[];
  active: SectionId;
  onSelect: (id: SectionId) => void;
  values: ActivityFormValues;
  /** Pane id → the problem that would fail the save. Shown as a dot; empty until the first save. */
  issues: Partial<Record<SectionId, string>>;
}) {
  return (
    <nav
      aria-label="Tour sections"
      className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:sticky lg:top-6 lg:mx-0 lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0"
    >
      {sections.map((s) => {
        const Icon = s.icon;
        const count = sectionCount(values, s.id);
        const issue = issues[s.id];
        const isActive = s.id === active;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={isActive ? 'page' : undefined}
            title={issue}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition-colors lg:w-full ${
              isActive
                ? 'bg-teal/10 text-teal-dark'
                : 'text-ink-muted hover:bg-ink/[0.04] hover:text-ink'
            }`}
          >
            <Icon width={16} height={16} className="shrink-0" />
            <span className="whitespace-nowrap lg:truncate">{s.label}</span>
            {issue && (
              <span
                className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-coral"
                aria-label={`${s.label}: ${issue}`}
              />
            )}
            {!issue && count != null && count > 0 && (
              <span className="ml-auto shrink-0 text-[11.5px] font-bold text-ink-muted/70">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
