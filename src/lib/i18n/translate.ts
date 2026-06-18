import type { Locale } from './config';
import { fr } from './messages';

/** French overrides keyed by the English source string. English is the source of truth, so the `en`
 *  table is empty (keys fall through to themselves). */
const TABLES: Record<Locale, Record<string, string>> = { en: {}, fr };

/**
 * Translate an English source string for `locale`, interpolating `{name}`-style vars. Missing keys
 * fall back to the English source, so an untranslated string still renders (never a raw key).
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = TABLES[locale];
  let out = locale !== 'en' && table[key] ? table[key]! : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(String(v));
    }
  }
  return out;
}
