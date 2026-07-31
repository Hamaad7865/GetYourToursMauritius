import { getBrowserSupabase } from '@/lib/supabase/browser';
import type { ContentDefaults } from '@/lib/catalogue/content-defaults';

/* Admin CRUD for per-category standard content. `activity_content_defaults` is staff-editable via RLS,
 * so the authenticated admin reads and writes it directly through the browser client — the same pattern
 * as the pricing editors.
 *
 * Spec: docs/superpowers/specs/2026-07-16-activity-content-defaults-design.md */

export interface CategoryDefaults extends ContentDefaults {
  category: string;
}

const EMPTY: ContentDefaults = {
  highlights: [],
  inclusions: [],
  exclusions: [],
  whatToBring: [],
  importantInfo: [],
};

/** Every saved standard set, keyed by category. Categories with no set simply don't appear.
 *
 * `locale = 'en'` only: the table now carries one row per (category, locale) — see
 * 20260901000700_translate_content_defaults_and_extra.sql — but this admin screen is the ENGLISH
 * editor only (there is no French editor for standard content yet). Without this filter, a category
 * with both an 'en' and an 'fr' row would return two rows here and whichever came back last would
 * silently win the `out[r.category] =` assignment below. */
export async function loadContentDefaults(): Promise<Record<string, ContentDefaults>> {
  const { data, error } = await getBrowserSupabase()
    .from('activity_content_defaults')
    .select('category, highlights, inclusions, exclusions, what_to_bring, important_info')
    .eq('locale', 'en');
  if (error) throw error;
  const out: Record<string, ContentDefaults> = {};
  for (const r of data ?? []) {
    out[r.category] = {
      highlights: r.highlights ?? [],
      inclusions: r.inclusions ?? [],
      exclusions: r.exclusions ?? [],
      whatToBring: r.what_to_bring ?? [],
      importantInfo: r.important_info ?? [],
    };
  }
  return out;
}

const clean = (xs: string[]): string[] => xs.map((s) => s.trim()).filter(Boolean);

/**
 * Save one category's standard set (English only — this is the English editor). Saving five EMPTY
 * lists deletes the row rather than storing an all-empty one — an absent row and an empty row mean
 * the same thing to the activity page, so this keeps the table honest about which categories actually
 * have standard content.
 *
 * The table's primary key is now (category, locale) — see
 * 20260901000700_translate_content_defaults_and_extra.sql — so both the delete and the upsert are
 * scoped to `locale = 'en'`: deleting without it would also drop a French translation row for this
 * category, and upserting on the old `category`-only conflict target would fail (or upsert into the
 * wrong row) now that category alone is no longer unique.
 */
export async function saveContentDefaults(category: string, input: ContentDefaults): Promise<void> {
  const sb = getBrowserSupabase();
  const row = {
    highlights: clean(input.highlights),
    inclusions: clean(input.inclusions),
    exclusions: clean(input.exclusions),
    what_to_bring: clean(input.whatToBring),
    important_info: clean(input.importantInfo),
  };
  const isEmpty = Object.values(row).every((list) => list.length === 0);

  if (isEmpty) {
    const { error } = await sb
      .from('activity_content_defaults')
      .delete()
      .eq('category', category)
      .eq('locale', 'en');
    if (error) throw error;
    return;
  }

  const { error } = await sb
    .from('activity_content_defaults')
    .upsert(
      { category, locale: 'en', ...row, updated_at: new Date().toISOString() },
      { onConflict: 'category,locale' },
    );
  if (error) throw error;
}

export { EMPTY as EMPTY_CONTENT_DEFAULTS };
