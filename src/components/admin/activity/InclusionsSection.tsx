'use client';

import { Section, StringList } from '@/components/admin/fields';
import type { PaneProps } from './sections';

export function InclusionsSection({
  v,
  set,
  highlightsOverridden,
}: PaneProps & {
  /** The category ships standard highlights, which REPLACE whatever is typed in this pane. */
  highlightsOverridden: boolean;
}) {
  return (
    <Section
      title="Inclusions"
      hint="What the tour promises and what the guest brings. “What to bring” and “Know before you go” fill the “Important information” block on the activity page — for catamaran & sightseeing tours they merge with the shared defaults (duplicates are removed)."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <StringList
          label="Highlights"
          items={v.highlights}
          onChange={(x) => set('highlights', x)}
          hint={
            highlightsOverridden ? (
              // Without this, the field silently does nothing on these tours — the trap that
              // hid 50 lines across 9 sightseeing tours. Say so instead of quietly discarding.
              <span className="text-[12px] font-semibold text-coral-dark">
                “{v.category}” has standard highlights, which replace anything you put here. Edit
                them in Standard content.
              </span>
            ) : undefined
          }
        />
        <StringList label="Languages" items={v.languages} onChange={(x) => set('languages', x)} />
        <StringList
          label="What's included"
          items={v.inclusions}
          onChange={(x) => set('inclusions', x)}
        />
        <StringList
          label="Not included"
          items={v.exclusions}
          onChange={(x) => set('exclusions', x)}
        />
        <StringList
          label="What to bring"
          items={v.whatToBring}
          onChange={(x) => set('whatToBring', x)}
        />
        <StringList
          label="Know before you go"
          items={v.importantInfo}
          onChange={(x) => set('importantInfo', x)}
        />
      </div>
    </Section>
  );
}
