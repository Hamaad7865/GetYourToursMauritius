'use client';

import { Field, inputClass } from '@/components/admin/fields';
import { Counter, SerpPreview, TITLE_BUDGET, DESC_BUDGET } from '@/components/admin/SerpPreview';
import { SITE } from '@/lib/seo/site';

/**
 * Per-tour <title> / meta-description overrides, with a live Google preview.
 *
 * The fallbacks previewed here MIRROR generateMetadata in app/(site)/activities/[slug]/page.tsx —
 * keep the two in step, or the editor previews something the page never ships. `seoTitle` becomes
 * an ABSOLUTE title on the page (the root "%s | Belle Mare Tours" template is bypassed), which is
 * why the built-in fallback appends the brand itself and the hint below tells the editor to.
 */
export function SearchAppearance({
  slug,
  title,
  summary,
  description,
  seoTitle,
  seoDescription,
  onSeoTitle,
  onSeoDescription,
}: {
  slug: string;
  title: string;
  summary: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  onSeoTitle: (v: string) => void;
  onSeoDescription: (v: string) => void;
}) {
  const fallbackTitle = `${title.trim() || 'Untitled tour'} | ${SITE.operator}`;
  const fallbackDescription = summary.trim() || description.trim() || SITE.description;
  const shownTitle = seoTitle.trim() || fallbackTitle;
  const shownDescription = seoDescription.trim() || fallbackDescription;

  return (
    <div className="flex flex-col gap-4">
      <SerpPreview
        path={`/activities/${slug.trim() || 'your-slug'}`}
        title={shownTitle}
        description={shownDescription}
      />
      <Field
        label="Search title"
        full
        hint="Include the brand yourself — this replaces the whole title tag. Front-load what people search for, e.g. “Île aux Cerfs Speedboat Trip with BBQ Lunch | Belle Mare Tours”."
      >
        <div className="flex flex-col gap-1">
          <input
            className={inputClass}
            value={seoTitle}
            onChange={(e) => onSeoTitle(e.target.value)}
            placeholder={fallbackTitle}
          />
          <span className="self-end">
            <Counter len={shownTitle.length} budget={TITLE_BUDGET} />
          </span>
        </div>
      </Field>
      <Field
        label="Search description"
        full
        hint="The grey text under the title. It does not affect ranking directly, but it decides who clicks."
      >
        <div className="flex flex-col gap-1">
          <textarea
            className={inputClass}
            rows={2}
            value={seoDescription}
            onChange={(e) => onSeoDescription(e.target.value)}
            placeholder={fallbackDescription}
          />
          <span className="self-end">
            <Counter len={shownDescription.length} budget={DESC_BUDGET} />
          </span>
        </div>
      </Field>
    </div>
  );
}
