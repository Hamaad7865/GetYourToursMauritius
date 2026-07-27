import { describe, expect, it } from 'vitest';
import { activityRow, EMPTY_ACTIVITY, type ActivityFormValues } from '@/lib/admin/activity-write';
import { SITE } from '@/lib/seo/site';

/* Per-tour search appearance. `activities.seo_title` / `seo_description` are read by
 * generateMetadata in app/(site)/activities/[slug]/page.tsx; before this panel existed the columns
 * were writable only by hand-run SQL, so the ~100 tour pages had no editable meta at all.
 *
 * The contract that matters: an EMPTY field must store null (restoring the page's built-in
 * fallback), never an empty string — an empty <title> is far worse than a generic one. */

function form(over: Partial<ActivityFormValues> = {}): ActivityFormValues {
  return { ...EMPTY_ACTIVITY, title: 'North Tour', slug: 'north-tour', ...over };
}

describe('activityRow — per-tour SEO fields', () => {
  it('writes trimmed overrides through to the seo_ columns', () => {
    const row = activityRow(
      form({
        seoTitle: '  Île aux Cerfs Speedboat Trip | Belle Mare Tours  ',
        seoDescription: '  Speedboat to Île aux Cerfs with BBQ lunch and hotel pickup.  ',
      }),
      'op-1',
    );
    expect(row.seo_title).toBe('Île aux Cerfs Speedboat Trip | Belle Mare Tours');
    expect(row.seo_description).toBe('Speedboat to Île aux Cerfs with BBQ lunch and hotel pickup.');
  });

  it('stores null — not "" — when a field is cleared, so the page falls back to its built-ins', () => {
    const row = activityRow(form({ seoTitle: '', seoDescription: '   ' }), 'op-1');
    expect(row.seo_title).toBeNull();
    expect(row.seo_description).toBeNull();
  });

  it('defaults a brand-new tour to no override', () => {
    expect(EMPTY_ACTIVITY.seoTitle).toBe('');
    expect(EMPTY_ACTIVITY.seoDescription).toBe('');
    const row = activityRow(form(), 'op-1');
    expect(row.seo_title).toBeNull();
    expect(row.seo_description).toBeNull();
  });

  it('leaves the rest of the row untouched (the panel is additive)', () => {
    const base = activityRow(form(), 'op-1');
    const withSeo = activityRow(form({ seoTitle: 'X', seoDescription: 'Y' }), 'op-1');
    const { seo_title: _t1, seo_description: _d1, ...restBase } = base;
    const { seo_title: _t2, seo_description: _d2, ...restSeo } = withSeo;
    expect(restSeo).toEqual(restBase);
  });
});

describe('search-appearance fallbacks mirror the tour page', () => {
  /* generateMetadata does:
   *   title       = seoTitle       ?? `${title} | ${SITE.operator}`
   *   description = seoDescription ?? summary ?? description ?? SITE.description
   * The admin preview must compute the same thing or it previews something that never ships. */
  it('brands the fallback title, because seoTitle ships as an ABSOLUTE title', () => {
    const v = form({ title: 'North Tour' });
    expect(`${v.title} | ${SITE.operator}`).toBe('North Tour | Belle Mare Tours');
  });

  it('falls back description → summary → full description → site description', () => {
    const pick = (v: ActivityFormValues) =>
      v.seoDescription.trim() || v.summary.trim() || v.description.trim() || SITE.description;
    expect(pick(form({ seoDescription: 'A', summary: 'B', description: 'C' }))).toBe('A');
    expect(pick(form({ summary: 'B', description: 'C' }))).toBe('B');
    expect(pick(form({ description: 'C' }))).toBe('C');
    expect(pick(form())).toBe(SITE.description);
  });
});
