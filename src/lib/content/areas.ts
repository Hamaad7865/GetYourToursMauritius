import { AREAS_RAW } from './_areas.gen';
import { AREAS_FR } from './_areas.fr.gen';
import { localiseContent } from './localise';
import { fitSnippet } from '@/lib/seo/snippet';
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

/**
 * Area guides that live at a top-level URL instead of under /destinations.
 *
 * Belle Mare is the brand's own place name and the phrase the site most needs to rank for, so its
 * guide sits at the bare /belle-mare. This map is the SINGLE place that move is expressed: `path`
 * is what the /destinations index links to, what the sitemap emits (both languages), and what the
 * page's canonical, breadcrumb and Place JSON-LD all read, so they cannot fall out of step. The old
 * /destinations/belle-mare 308s here from next.config.mjs — see the redirect block there, which
 * also carries the /fr twin (config redirects run BEFORE the locale middleware, so the prefixed
 * path needs its own rule and does not inherit this one).
 *
 * Adding an entry here without the matching redirect strands the old URL on a live page that
 * nothing links to; the pair is guarded by tests/unit/belle-mare-page.test.ts.
 */
export const AREA_PATH_OVERRIDES: Record<string, string> = {
  'belle-mare': '/belle-mare',
};

export function destinationPath(slug: string): string {
  return AREA_PATH_OVERRIDES[slug] ?? `/destinations/${slug}`;
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

/**
 * Hand-tuned search titles/descriptions for areas where Search Console shows the generic pattern
 * missing the dominant query. Belle Mare: "belle mare", "belle mare mauritius" and "belle mare beach"
 * are 56% of the page's impressions, at ~0.6% CTR under the old "Area Guide" title — and it is the
 * one area with a curated hotel list, so it can honestly promise hotels.
 */
const AREA_META: Partial<Record<string, Record<Locale, { title: string; description: string }>>> = {
  'belle-mare': {
    en: {
      title: 'Belle Mare Beach, Mauritius: Hotels & Things to Do',
      description:
        'Belle Mare’s long white-sand beach and turquoise lagoon on Mauritius’ east coast: the resorts along it, Île aux Cerfs trips and what to do nearby.',
    },
    fr: {
      title: 'Belle Mare, île Maurice : plage, hôtels et activités',
      description:
        'La longue plage de sable blanc et le lagon turquoise de Belle Mare, sur la côte est de l’île Maurice : hôtels, sorties à l’île aux Cerfs et activités.',
    },
  },
};

export function areaMetaTitle(a: Area, locale: Locale = 'en'): string {
  // The root template appends " | Belle Mare Tours" (19 chars), so the page-specific part stays near
  // 40 to fit Google's ~60-char window — and if a long name pushes it over, the cut falls on the
  // brand, not on the words that make someone click. "Area Guide" promised nothing; "Things to Do" is
  // what these searchers want. (The "(Things to Do, Beaches & Transfers)" suffix this family once had
  // ran to 95 and lost its keywords to the cut.) French pages were serving the English title.
  const tuned = AREA_META[a.slug]?.[locale];
  if (tuned) return tuned.title;
  return locale === 'fr'
    ? `${a.name}, île Maurice : que voir, que faire`
    : `${a.name}, Mauritius: Things to Do`;
}

export function areaMetaDescription(a: Area, locale: Locale = 'en'): string {
  // Pass the LOCALISED area: `intro` is the translated copy on French pages.
  return AREA_META[a.slug]?.[locale]?.description ?? fitSnippet(a.intro);
}

/** An area guide in the visitor's language, falling back to English per field. */
export function localisedArea(area: Area, locale: Locale): Area {
  return localiseContent(area, AREAS_FR[area.slug], locale);
}
