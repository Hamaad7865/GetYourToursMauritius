'use client';

import { Field, Section, StringList, inputClass } from '@/components/admin/fields';
import {
  isMachineDraft,
  type ActivityTranslationForm,
  type SupplementInput,
} from '@/lib/admin/activity-write';

/**
 * The tour's French copy (activity_translations, locale 'fr').
 *
 * This used to be a collapsed-by-default card because it sat in the middle of a very long scroll
 * and most edits never touched it. It is its own pane now, so the collapse is gone — reaching it
 * already costs one click and nothing else.
 *
 * This admin area is staff-only and stays English, so none of these labels are wrapped in `t()`.
 */
export function FrenchSection({
  fr,
  setFr,
  frSource,
  supplements,
  setSupplements,
}: {
  fr: ActivityTranslationForm;
  setFr: (fr: ActivityTranslationForm) => void;
  /** 'machine' | 'human' | undefined (no translation row yet, e.g. a brand-new activity). */
  frSource: string | undefined;
  /** The activity's supplements (same rows the Pricing pane edits) — this pane edits each row's
   *  FRENCH label (activity_supplements.name_fr). Undefined for the restricted 'seo' content role,
   *  whose RLS can't write that table — the block is hidden rather than silently losing edits. */
  supplements?: SupplementInput[];
  setSupplements?: (next: SupplementInput[]) => void;
}) {
  return (
    <Section
      title="Français"
      hint="Optional French copy for this tour’s public page. Leave a field blank to fall back to the English."
    >
      <div className="flex flex-col gap-4">
        {isMachineDraft({ source: frSource }) && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Machine draft — not yet reviewed. Edit any field, or save, to mark it reviewed.
          </p>
        )}
        <Field label="Title" full>
          <input
            className={inputClass}
            value={fr.title ?? ''}
            onChange={(e) => setFr({ ...fr, title: e.target.value })}
          />
        </Field>
        <Field label="Short summary" full>
          <textarea
            className={inputClass}
            rows={2}
            value={fr.summary ?? ''}
            onChange={(e) => setFr({ ...fr, summary: e.target.value })}
          />
        </Field>
        <Field label="Full description" full>
          <textarea
            className={inputClass}
            rows={6}
            value={fr.description ?? ''}
            onChange={(e) => setFr({ ...fr, description: e.target.value })}
          />
        </Field>
        <Field label="Meeting point">
          <input
            className={inputClass}
            value={fr.meetingPoint ?? ''}
            onChange={(e) => setFr({ ...fr, meetingPoint: e.target.value })}
          />
        </Field>
        {supplements && setSupplements && supplements.some((s) => s.name.trim()) && (
          <Field
            label="Optional supplements"
            hint="Only the names — each price is the same in both languages."
          >
            <div className="flex flex-col gap-2.5">
              {supplements.map((s, idx) =>
                s.name.trim() ? (
                  <input
                    key={s.id ?? `new-${idx}`}
                    className={inputClass}
                    placeholder={s.name || 'e.g. Homard au déjeuner'}
                    value={s.nameFr}
                    onChange={(e) =>
                      setSupplements(
                        supplements.map((x, i) =>
                          i === idx ? { ...x, nameFr: e.target.value } : x,
                        ),
                      )
                    }
                  />
                ) : null,
              )}
            </div>
          </Field>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <StringList
            label="Highlights"
            items={fr.highlights}
            onChange={(x) => setFr({ ...fr, highlights: x })}
          />
          <StringList
            label="What's included"
            items={fr.inclusions}
            onChange={(x) => setFr({ ...fr, inclusions: x })}
          />
          <StringList
            label="Not included"
            items={fr.exclusions}
            onChange={(x) => setFr({ ...fr, exclusions: x })}
          />
        </div>
        <Field label="Search title" full>
          <input
            className={inputClass}
            value={fr.seoTitle ?? ''}
            onChange={(e) => setFr({ ...fr, seoTitle: e.target.value })}
          />
        </Field>
        <Field label="Search description" full>
          <textarea
            className={inputClass}
            rows={2}
            value={fr.seoDescription ?? ''}
            onChange={(e) => setFr({ ...fr, seoDescription: e.target.value })}
          />
        </Field>
      </div>
    </Section>
  );
}
