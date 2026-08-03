'use client';

import { Section } from '@/components/admin/fields';
import { BadgesEditor } from './BadgesEditor';
import type { PaneProps } from './sections';

export function BadgesSection({ v, set }: PaneProps) {
  return (
    <Section
      title="Badges"
      hint="Custom badges replace the default highlights strip on the activity page. Leave empty to keep the defaults."
    >
      <BadgesEditor badges={v.badges} onChange={(x) => set('badges', x)} />
    </Section>
  );
}
