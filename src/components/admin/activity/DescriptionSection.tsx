'use client';

import { Field, Section, inputClass } from '@/components/admin/fields';
import type { PaneProps } from './sections';

export function DescriptionSection({ v, set }: PaneProps) {
  return (
    <Section
      title="Description"
      hint="The summary is the one-line pitch on the tour card and in search results; the full description is the body of the tour page."
    >
      <div className="flex flex-col gap-4">
        <Field label="Short summary" full>
          <textarea
            className={inputClass}
            rows={2}
            value={v.summary}
            onChange={(e) => set('summary', e.target.value)}
            placeholder="A full day exploring the north…"
          />
        </Field>
        <Field label="Full description" full>
          <textarea
            className={inputClass}
            rows={12}
            value={v.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
      </div>
    </Section>
  );
}
