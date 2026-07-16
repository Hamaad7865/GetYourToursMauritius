/**
 * Per-category standard content ("shared defaults") — the admin-editable replacement for the two
 * hardcoded files that used to live in src/lib/content/{sightseeing,catamaran}.ts.
 *
 * Spec: docs/superpowers/specs/2026-07-16-activity-content-defaults-design.md
 *
 * Pure + client-safe: no DB, no env. The activity page loads the defaults map and calls `applyDefaults`.
 */

export interface ContentDefaults {
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  whatToBring: string[];
  importantInfo: string[];
}

/** Every standard set, keyed by `activities.category` (free text, owner-managed). */
export type ContentDefaultsMap = Record<string, ContentDefaults>;

export const EMPTY_DEFAULTS: ContentDefaults = {
  highlights: [],
  inclusions: [],
  exclusions: [],
  whatToBring: [],
  importantInfo: [],
};

/**
 * Shared lines lead, the activity's own follow, exact-string duplicates dropped. This is precisely how
 * "What to bring" / "Know before you go" already behaved against the hardcoded sets.
 */
export function mergeList(shared: readonly string[], own: readonly string[]): string[] {
  return [...shared, ...own.filter((line) => !shared.includes(line))];
}

/**
 * Highlights REPLACE rather than merge (unchanged from the hardcoded behaviour). The shared set is
 * prose operator promises, whereas a tour's own `highlights` are bare place names — the stops it visits
 * ("Trou aux Biches Beach"), which duplicate the Itinerary. Merging renders six prose sentences followed
 * by five labels, so the shared set wins outright.
 *
 * An EMPTY shared list falls through to the activity's own, so a category with a standard set that
 * simply has no highlights never blanks the section.
 */
export function replaceList(shared: readonly string[], own: readonly string[]): string[] {
  return shared.length > 0 ? [...shared] : [...own];
}

/** One activity's own five lists, as stored (`activities.*` + `extra.*`). */
export interface ActivityContent {
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  whatToBring: string[];
  importantInfo: string[];
}

/**
 * Resolve what the activity page renders: the standard set for this activity's category (if any),
 * combined with the activity's own lists. A category with no standard set returns the activity's own
 * content untouched — which is also the fail-soft path when the defaults RPC is unavailable.
 */
export function applyDefaults(
  category: string,
  own: ActivityContent,
  defaults: ContentDefaultsMap,
): ActivityContent {
  const shared = defaults[category];
  if (!shared) return { ...own };
  return {
    highlights: replaceList(shared.highlights, own.highlights),
    inclusions: mergeList(shared.inclusions, own.inclusions),
    exclusions: mergeList(shared.exclusions, own.exclusions),
    whatToBring: mergeList(shared.whatToBring, own.whatToBring),
    importantInfo: mergeList(shared.importantInfo, own.importantInfo),
  };
}

/** True when this category's standard set overrides an activity's own Highlights box (drives the
 *  admin notice, so the field never silently does nothing). */
export function highlightsAreOverridden(category: string, defaults: ContentDefaultsMap): boolean {
  return (defaults[category]?.highlights.length ?? 0) > 0;
}
