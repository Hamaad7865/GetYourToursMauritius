'use client';

import { Field, Section, inputClass } from '@/components/admin/fields';
import type { CategoryItem } from '@/lib/categories/categories';
import type { ActivityFormValues } from '@/lib/admin/activity-write';
import type { PaneProps } from './sections';

export function BasicsSection({
  v,
  set,
  categories,
  onTitle,
  onSlug,
}: PaneProps & {
  categories: CategoryItem[];
  /** Retypes the slug from the title until the slug has been edited by hand. */
  onTitle: (title: string) => void;
  onSlug: (slug: string) => void;
}) {
  return (
    <Section title="Basics">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required full>
          <input
            className={inputClass}
            value={v.title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="North Tour – Port Louis, Pamplemousses & Cap Malheureux"
          />
        </Field>
        <Field label="URL slug" required hint="The web address: /activities/your-slug">
          <input
            className={inputClass}
            value={v.slug}
            onChange={(e) => onSlug(e.target.value)}
            placeholder="north-tour"
          />
        </Field>
        <Field label="Category" required>
          <select
            className={inputClass}
            value={v.category}
            onChange={(e) => set('category', e.target.value)}
          >
            {/* Always include the current value so editing an activity in a removed/renamed
                category still shows it. */}
            {[...new Set([...categories.map((c) => c.name), v.category].filter(Boolean))].map(
              (c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="Type">
          <select
            className={inputClass}
            value={v.type}
            onChange={(e) => set('type', e.target.value as ActivityFormValues['type'])}
          >
            <option value="activity">Activity</option>
            <option value="transport">Transport / transfer</option>
          </select>
        </Field>
        <Field label="Status">
          <select
            className={inputClass}
            value={v.status}
            onChange={(e) => set('status', e.target.value as ActivityFormValues['status'])}
          >
            <option value="published">Published (visible on the site)</option>
            <option value="draft">Draft (hidden)</option>
          </select>
        </Field>
        <Field label="Location">
          <input
            className={inputClass}
            value={v.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="North"
          />
        </Field>
        <Field label="Duration (minutes)">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={v.durationMinutes ?? ''}
            onChange={(e) => set('durationMinutes', e.target.value ? Number(e.target.value) : null)}
            placeholder="480"
          />
        </Field>
        <Field label="Minimum advance booking (days)">
          <input
            type="number"
            min={0}
            max={60}
            className={inputClass}
            value={v.minAdvanceDays}
            onChange={(e) =>
              set('minAdvanceDays', e.target.value ? Math.max(0, Number(e.target.value)) : 0)
            }
            placeholder="1"
          />
          <p className="mt-1.5 text-[12px] text-ink-muted">
            How many days ahead a customer must book. 1 = next day (the default — no same-day).
            Raise it for trips that need planning (e.g. 3); the date picker hides any sooner dates
            and the server rejects them.
          </p>
        </Field>
      </div>
    </Section>
  );
}
