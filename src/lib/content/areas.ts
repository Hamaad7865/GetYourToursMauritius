import { AREAS_RAW } from './_areas.gen';
import { AREAS_FR } from './_areas.fr.gen';
import { localiseContent } from './localise';
import type { Locale } from '@/lib/i18n/config';

/** Mauritius area / destination guides. Raw content is generated into `_areas.gen.ts`. */

export type AreaRegion = 'North' | 'South' | 'East' | 'West' | 'Central';

export interface AreaContent {
  slug: string;
  name: string;
  region: AreaRegion;
  intro: string;
  highlights: string[];
  beaches: string[];
  /** Named hotels/resorts actually in or immediately by the area. Optional — most areas don't set
   *  this yet; the destination page hides the section entirely when it's empty. */
  stayOptions?: string[];
  gettingThere: string;
  goodFor: string[];
  nearbyAttractions: string[];
  faq: { q: string; a: string }[];
}

/**
 * The fields of an area guide that may be translated. An ALLOWLIST, deliberately: everything
 * omitted here — `slug`, `region`, `name`, `beaches`, `stayOptions`, `nearbyAttractions` — is a
 * real Mauritian place, beach or hotel name, and a translation file that tried to set one would
 * invent French names for real places. Omitting them makes that a compile error rather than a
 * production defect nobody notices.
 */
export type AreaTranslation = Partial<
  Pick<AreaContent, 'intro' | 'highlights' | 'gettingThere' | 'goodFor' | 'faq'>
>;

export interface Area extends AreaContent {
  path: string;
}

export function destinationPath(slug: string): string {
  return `/destinations/${slug}`;
}

export const AREA_REGION_ORDER: AreaRegion[] = ['North', 'East', 'South', 'West', 'Central'];

export const areas: Area[] = AREAS_RAW.map((a) => ({ ...a, path: destinationPath(a.slug) })).sort(
  (a, b) => {
    const ci = AREA_REGION_ORDER.indexOf(a.region) - AREA_REGION_ORDER.indexOf(b.region);
    return ci !== 0 ? ci : a.name.localeCompare(b.name);
  },
);

export function getArea(slug: string): Area | null {
  return areas.find((a) => a.slug === slug) ?? null;
}

export function areaMetaTitle(a: Area): string {
  // The root template appends " | Belle Mare Tours" (19 chars), so the page-specific part has to
  // stay around 40 to keep the whole title inside Google's ~60-char display window. The longer
  // "(Things to Do, Beaches & Transfers)" suffix this replaced pushed every destination page to 95
  // and was simply truncated in results — the keywords it added were never actually shown.
  return `${a.name}, Mauritius — Area Guide`;
}

export function areaMetaDescription(a: Area): string {
  // Keep within Google's ~160-char snippet window and cut on a word boundary (not mid-word) so the
  // snippet reads cleanly instead of being rewritten.
  const text = a.intro.trim();
  if (text.length <= 155) return text;
  const cut = text.slice(0, 155);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 120 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–—-]+$/, '')}…`;
}

/** An area guide in the visitor's language, falling back to English per field. */
export function localisedArea(area: Area, locale: Locale): Area {
  return localiseContent(area, AREAS_FR[area.slug], locale);
}
