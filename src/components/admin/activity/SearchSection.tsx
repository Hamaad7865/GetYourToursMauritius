'use client';

import { Section } from '@/components/admin/fields';
import { SearchAppearance } from './SearchAppearance';
import type { PaneProps } from './sections';

export function SearchSection({ v, set }: PaneProps) {
  return (
    <Section
      title="Search appearance"
      hint="How this tour looks in Google results. Both fields are optional — leave them empty and the page falls back to its own title and summary."
    >
      <SearchAppearance
        slug={v.slug}
        title={v.title}
        summary={v.summary}
        description={v.description}
        seoTitle={v.seoTitle}
        seoDescription={v.seoDescription}
        onSeoTitle={(t) => set('seoTitle', t)}
        onSeoDescription={(d) => set('seoDescription', d)}
      />
    </Section>
  );
}
