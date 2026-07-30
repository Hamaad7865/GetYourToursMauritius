import type { Locale } from '@/lib/i18n/config';

/** Fields that identify or structure content and must never come from a translation file. A
 *  translated slug would break every URL and every internal link pointing at the page. */
const NEVER_TRANSLATED = new Set(['slug', 'path', 'region', 'image', 'images']);

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
 */
export function localiseContent<T extends object>(
  english: T,
  french: Partial<T> | undefined,
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
