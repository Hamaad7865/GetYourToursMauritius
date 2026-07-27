'use client';

/**
 * Shared Google-snippet preview + character counters for every SEO-editable surface.
 *
 * Extracted from AdminSeoMeta so the page-meta editor (/admin/seo) and the per-tour "Search
 * appearance" panel (/admin/activities/…) show the SAME budgets and the SAME rendering — an editor
 * who learns one screen has learned the other.
 */

/** Re-exported so an editor screen needs one import; the audit reads the same source. */
export { TITLE_BUDGET, DESC_BUDGET } from '@/lib/seo/budgets';

export function Counter({ len, budget }: { len: number; budget: number }) {
  return (
    <span
      className={`text-[11.5px] font-semibold ${len > budget ? 'text-coral' : 'text-ink-muted'}`}
    >
      {len}/{budget}
    </span>
  );
}

/**
 * A Google-style result row. `title`/`description` are the EFFECTIVE values (override if set, else
 * the built-in fallback) so the editor previews what actually ships, not what is typed.
 */
export function SerpPreview({
  path,
  title,
  description,
}: {
  path: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-[#EAEEF0] bg-[#F7F8FA] px-4 py-3">
      <p className="truncate text-[13px] text-[#1a6f38]">
        bellemaretours.com{path === '/' ? '' : path}
      </p>
      <p className="mt-0.5 truncate text-[16.5px] font-medium text-[#1a0dab]">{title}</p>
      <p className="mt-0.5 line-clamp-2 text-[13px] text-ink/70">{description}</p>
    </div>
  );
}
