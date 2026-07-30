import type { Locale } from '@/lib/i18n/config';

/**
 * Structural identifiers that must never come from a translation file, whatever the content type.
 * A translated slug or path would break every URL and every internal link pointing at the page.
 *
 * This is only a runtime backstop. The primary defence is the per-module translation TYPE, which
 * allowlists exactly the prose fields — see `AreaTranslation` in `areas.ts`. A blocklist is the
 * wrong shape for the real risk here: the content modules are full of real Mauritian place, beach
 * and hotel names (`beaches`, `stayOptions`, `nearbyAttractions`, and an area's `name`), and a
 * blocklist silently lets through any such field nobody thought to add. An allowlist fails closed,
 * and fails at compile time rather than in production with invented French beach names.
 */
const NEVER_TRANSLATED = new Set(['slug', 'path', 'id']);

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Merge a French entry over its English source, per field. Mirrors the SQL `coalesce(t.f, a.f)`
 * rule: an absent or empty French field keeps the English text, so a partially translated guide
 * degrades gracefully instead of rendering blank sections.
 *
 * The merge is top-level only — an array field (including an array of objects like `faq`) is
 * swapped wholesale when non-empty, never merged element-wise. So a French `faq` must translate
 * every entry or none; a half-filled array would drop the untranslated questions entirely.
 *
 * `NoInfer` on the French parameter keeps `T` inferred from `english` alone. Without it,
 * `localiseContent(area, AREAS_FR[area.slug], locale)` infers `T` from the narrower translation
 * type and the return value silently loses fields (e.g. `Area.path`).
 */
export function localiseContent<T extends object>(
  english: T,
  french: Partial<NoInfer<T>> | undefined,
  locale: Locale,
): T {
  if (locale === 'en' || !french) return english;
  const out = { ...english };
  for (const [key, value] of Object.entries(french)) {
    if (NEVER_TRANSLATED.has(key) || isEmpty(value)) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
