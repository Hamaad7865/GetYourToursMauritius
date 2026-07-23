import { AREAS_RAW } from './_areas.gen';

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
  // Root template appends the site name.
  return `${a.name}, Mauritius — Area Guide (Things to Do, Beaches & Transfers)`;
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
