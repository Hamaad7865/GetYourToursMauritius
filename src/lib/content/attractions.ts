import type { PlannerPlace } from '@/lib/validation/planner';
import { SITE } from '@/lib/seo/site';
import { ATTRACTION_IMAGES } from './_attraction-images.gen';
import { ATTRACTIONS_FR, REGION_INTRO_FR } from './_additional-attractions.fr.gen';
import { localiseContent } from './localise';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';

/** Real Wikimedia photo for an attraction, or null (then the card/detail uses the gradient hero). */
export function attractionImage(slug: string): { url: string; source: string } | null {
  return ATTRACTION_IMAGES[slug] ?? null;
}

/**
 * The src to actually render for an attraction photo. Wikimedia thumbnails are hot-linked from
 * upload.wikimedia.org, which rate-limits (429) the ~20-image burst a single page load fires — so route
 * those through our cached /api/img proxy (served from our own edge, fetched from Wikimedia at most once
 * per POP). Local/own photos and any other host are returned unchanged.
 */
export function attractionImageSrc(url: string): string {
  try {
    if (new URL(url, 'https://x').hostname === 'upload.wikimedia.org') {
      return `/api/img?u=${encodeURIComponent(url)}`;
    }
  } catch {
    /* not an absolute URL — a local /public path; use it directly */
  }
  return url;
}

/**
 * Presentation + SEO content layer for attraction pages. The base data (name, region,
 * coords, blurb) comes from `planner_places`; this module adds region/category framing,
 * programmatic copy, an FAQ builder and optional hand-written editorial for marquee spots.
 * Real-world data (place names/blurbs) is not translated — only UI chrome elsewhere is.
 */

export const REGION_ORDER = ['North', 'East', 'South', 'West', 'Central'] as const;

export const REGION_INTRO: Record<string, string> = {
  North:
    "The north is Mauritius' liveliest coast — Grand Baie's emerald lagoon, the longest white-sand beaches on the island, and the red-roofed chapel at Cap Malheureux looking out to the northern islets.",
  East: "The east coast is calm and unspoilt: Belle Mare's six-kilometre beach, the lagoons of Île aux Cerfs and authentic fishing villages. This is Belle Mare Tours' home turf, so pickups here are quick and cheap.",
  South:
    "The wild south holds the island's most dramatic scenery — the Seven Coloured Earths at Chamarel, the tallest waterfall, the UNESCO-listed Le Morne mountain and clifftop viewpoints over the Indian Ocean.",
  West: "The sunny west is built for adventure: Flic-en-Flac's reef, Casela's safari park, the Black River Gorges and boat trips to Île aux Bénitiers and Crystal Rock.",
  Central:
    "The cooler central plateau is green and scenic — the Trou aux Cerfs volcanic crater, colonial Eureka House, botanical gardens and the island's best mountain hikes.",
};

/** French overlay for `REGION_INTRO`, keyed by the same region name. An allowlist of one: the only
 *  field is the prose paragraph itself, so there is nothing to accidentally widen. */
export type RegionIntroTranslation = Partial<Record<string, string>>;

/** A region's intro paragraph in the visitor's language, falling back to English per region. */
export function localisedRegionIntro(region: string, locale: Locale): string {
  return localiseContent(
    { intro: REGION_INTRO[region] ?? '' },
    REGION_INTRO_FR[region] ? { intro: REGION_INTRO_FR[region] } : undefined,
    locale,
  ).intro;
}

export interface CategoryMeta {
  label: string;
  emoji: string;
  /** Tailwind gradient classes for the fallback hero when a place has no photo. */
  gradient: string;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  Beach: { label: 'Beach', emoji: '🏖️', gradient: 'from-[#13a0a6] to-[#0B5C63]' },
  Waterfall: { label: 'Waterfall', emoji: '💧', gradient: 'from-[#0E8C92] to-[#0B5C63]' },
  Viewpoint: { label: 'Viewpoint', emoji: '🏔️', gradient: 'from-[#1f7a8c] to-[#0B5C63]' },
  Nature: { label: 'Nature & wildlife', emoji: '🌿', gradient: 'from-[#2a9d5c] to-[#0B5C63]' },
  Culture: { label: 'Culture & heritage', emoji: '🛕', gradient: 'from-[#b9744f] to-[#7a3f2a]' },
  Garden: { label: 'Garden', emoji: '🌺', gradient: 'from-[#2a9d5c] to-[#0E6C52]' },
  Island: { label: 'Island', emoji: '🏝️', gradient: 'from-[#13a0a6] to-[#0B5C63]' },
  Market: { label: 'Market', emoji: '🧺', gradient: 'from-[#c98a3a] to-[#7a3f2a]' },
  Landmark: { label: 'Landmark', emoji: '📍', gradient: 'from-[#1f7a8c] to-[#0B5C63]' },
  Food: { label: 'Food', emoji: '🍽️', gradient: 'from-[#c98a3a] to-[#7a3f2a]' },
};

export function categoryMeta(category: string): CategoryMeta {
  return (
    CATEGORY_META[category] ?? {
      label: category,
      emoji: '📍',
      gradient: 'from-[#13a0a6] to-[#0B5C63]',
    }
  );
}

export function attractionPath(slug: string): string {
  return `/attractions/${slug}`;
}

/** Human-friendly "time to spend here" from a minutes value. */
export function formatVisitDuration(min: number, locale: Locale = 'en'): string {
  if (locale === 'fr') {
    if (min < 60) return `environ ${min} minute${min > 1 ? 's' : ''}`;
    const hoursFr = min / 60;
    if (Number.isInteger(hoursFr)) return `environ ${hoursFr} heure${hoursFr > 1 ? 's' : ''}`;
    return `${Math.floor(hoursFr)}–${Math.ceil(hoursFr)} heures`;
  }
  if (min < 60) return `about ${min} minutes`;
  const hours = min / 60;
  if (Number.isInteger(hours)) return `about ${hours} hour${hours > 1 ? 's' : ''}`;
  return `${Math.floor(hours)}–${Math.ceil(hours)} hours`;
}

export function attractionMetaTitle(p: PlannerPlace): string {
  // The root metadata template appends the site name, so don't repeat the brand here.
  return `${p.name}, ${p.region} Mauritius — Visitor Guide`;
}

export function attractionMetaDescription(p: PlannerPlace): string {
  const lead = p.blurb
    ? `${p.blurb} `
    : `${p.name} is one of the highlights of ${p.region.toLowerCase()} Mauritius. `;
  return `${lead}Visit with ${SITE.operator}: private pickup anywhere in Mauritius, licensed driver-guides and instant online booking.`.slice(
    0,
    320,
  );
}

/** Optional hand-written editorial for marquee attractions — layered on top of the blurb. */
export interface AttractionExtra {
  body?: string[];
  bestTime?: string;
  tips?: string[];
}

export const ATTRACTION_EXTRA: Record<string, AttractionExtra> = {
  'chamarel-seven-coloured-earth': {
    body: [
      'The Seven Coloured Earths are Mauritius’ most photographed natural wonder: undulating dunes of red, brown, violet, green, blue, purple and yellow sand that never erode together, a quirk of the volcanic clay. The geopark sits in the lush Chamarel valley and the ticket also covers the nearby Chamarel Waterfall viewpoint and a giant-tortoise enclosure.',
      'It pairs naturally with a full day in the south-west — most of our South and Chamarel tours combine it with the waterfall, the rum distillery and Le Morne, so you see the best of the region in one private outing.',
    ],
    bestTime:
      'Go early (9–10am) for the best colour and the smallest crowds; the dunes glow most after light rain.',
    tips: [
      'Allow ~2 hours to include the waterfall viewpoint and tortoise park.',
      'Combine with Chamarel Waterfall and the rum distillery, which are next door.',
      'There is an entrance fee paid on arrival — we include or itemise it transparently in your quote.',
    ],
  },
  'le-morne-brabant': {
    body: [
      'Le Morne Brabant is a 556-metre basaltic monolith on the south-west tip of the island and a UNESCO World Heritage site, honoured as a refuge for escaped slaves. The lagoon and beach at its foot are among the most beautiful in Mauritius and a world-class kitesurfing spot.',
      'You can admire it from the beach and viewpoints on a sightseeing tour, or take on the guided summit hike for panoramic views over the south-west reef — we can arrange either with hotel pickup.',
    ],
    bestTime:
      'Morning, before the afternoon wind picks up — ideal for both the hike and calm-water photos.',
    tips: [
      'The summit hike is guided and takes ~3–4 hours return.',
      'Bring water, sun protection and proper shoes for the climb.',
    ],
  },
  'ile-aux-cerfs': {
    body: [
      'Île aux Cerfs is the postcard island of the east coast: powder-white sand, a turquoise lagoon, an 18-hole championship golf course and every water sport going. It sits just off Trou d’Eau Douce, a short boat hop from Belle Mare — our doorstep.',
      'Most visitors reach it on a catamaran cruise or speedboat tour that includes the Grand River South East waterfall, snorkelling stops and a beach barbecue lunch.',
    ],
    bestTime:
      'Weekdays are quieter than weekends; arrive mid-morning to claim a good patch of beach.',
    tips: [
      'Reached by boat from Trou d’Eau Douce — we handle the transfer and the cruise.',
      'Bring reef-safe sunscreen, a towel and water shoes.',
    ],
  },
  'grand-baie-beach': {
    body: [
      'Grand Baie is the north’s buzziest resort town — a sheltered bay with calm swimming, beach bars, boutiques and the island’s best nightlife, plus departure points for catamaran trips to the northern islets.',
      'It makes an easy half-day or a base for a North tour taking in Cap Malheureux, Pamplemousses Garden and the Port Louis market.',
    ],
    bestTime: 'Late afternoon for the sunset and the lively evening scene.',
    tips: ['Great launch point for catamaran cruises to Coin de Mire and Île Gabriel.'],
  },
  'casela-nature-parks': {
    body: [
      'Casela Nature & Leisure Park spreads over 350 hectares on the west coast and packs in African safari drives, big cats, giant tortoises, zip-lines, quad trails and a petting farm — the island’s top pick for families and thrill-seekers.',
      'Plan a full day; with private transport you can arrive at opening and beat the tour-bus rush.',
    ],
    bestTime:
      'Arrive at opening (9am) for the animals at their most active and the shortest queues.',
    tips: [
      'Allow most of a day.',
      'Pre-book any safari or zip-line add-ons — we can include them in your plan.',
    ],
  },
  'pamplemousses-botanical-garden': {
    body: [
      'The Sir Seewoosagur Ramgoolam Botanical Garden at Pamplemousses is one of the oldest tropical gardens in the world, famous for its pond of giant Amazon water lilies, dozens of palm species and the talipot palm that flowers once a century.',
      'It is a relaxed, shaded stop that combines well with the Port Louis market and the north coast on a sightseeing day.',
    ],
    bestTime: 'Morning, when it is cooler and the water lilies are fully open.',
    tips: [
      'A licensed guide at the gate brings the garden’s stories to life — worth it.',
      'Closes around 5:30pm.',
    ],
  },
};

/**
 * The fields of an attraction that may be translated. An ALLOWLIST, deliberately: `blurb` is our own
 * descriptive copy (from `_additional-attractions.gen.ts`, or from the `planner_places` DB rows —
 * either way it degrades to English when no French entry exists), and `body`/`bestTime`/`tips` are
 * our own hand-written editorial for marquee spots. Everything else on `PlannerPlace` — `id`, `name`,
 * `category`, `region`, `lat`, `lng`, `closesAt` — is a real place name or a structural/numeric fact,
 * not prose, and is not present here.
 */
export type AttractionTranslation = Partial<Pick<PlannerPlace, 'blurb'>> &
  Partial<Pick<AttractionExtra, 'body' | 'bestTime' | 'tips'>>;

/** A place's blurb in the visitor's language, falling back to English when untranslated. Only
 *  `blurb` is ever overlaid — every other field (name, category, coords…) is real-world data. */
export function localisedPlace(place: PlannerPlace, locale: Locale): PlannerPlace {
  const entry = ATTRACTIONS_FR[place.id];
  return localiseContent(place, entry?.blurb ? { blurb: entry.blurb } : undefined, locale);
}

/** The hand-written editorial for a marquee attraction, in the visitor's language. Undefined when
 *  the slug has no editorial at all (most attractions), matching `ATTRACTION_EXTRA`'s own shape. */
export function localisedAttractionExtra(
  slug: string,
  locale: Locale,
): AttractionExtra | undefined {
  const extra = ATTRACTION_EXTRA[slug];
  if (!extra) return undefined;
  const entry = ATTRACTIONS_FR[slug];
  const fr =
    entry && (entry.body || entry.bestTime || entry.tips)
      ? { body: entry.body, bestTime: entry.bestTime, tips: entry.tips }
      : undefined;
  return localiseContent(extra, fr, locale);
}

/** Same-region neighbours first, then fill from elsewhere — for the "Nearby attractions" rail. */
export function nearbyPlaces(all: PlannerPlace[], place: PlannerPlace, n = 4): PlannerPlace[] {
  const sameRegion = all.filter((p) => p.id !== place.id && p.region === place.region);
  const others = all.filter((p) => p.id !== place.id && p.region !== place.region);
  return [...sameRegion, ...others].slice(0, n);
}

/**
 * Unique, useful FAQ per place — also emitted as FAQPage structured data. The question/answer prose
 * is templated (not stored per-slug), so it is localised by routing through the same `t()` key/value
 * catalogue as UI chrome rather than a per-slug overlay — `name`/`region`/`durationMin`/`closesAt`
 * stay real data, interpolated into whichever language's template.
 */
export function buildAttractionFaq(
  p: PlannerPlace,
  locale: Locale = 'en',
): { q: string; a: string }[] {
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  // English keeps the original wording exactly: lowercase compass word in "the north side", but the
  // capitalised region name ("North") in "a private North sightseeing tour". French uses the same
  // properly cased region label ("Nord") in both places — it doesn't have an idiomatic lowercase form.
  const regionSide = locale === 'fr' ? t(p.region) : p.region.toLowerCase();
  const regionLabel = locale === 'fr' ? t(p.region) : p.region;
  const duration = formatVisitDuration(p.durationMin, locale);
  const faqs: { q: string; a: string }[] = [
    {
      q: t('Where is {name}?', { name: p.name }),
      a: t(
        '{name} is on the {region} side of Mauritius. {operator} can collect you from your hotel anywhere on the island and drive you there with a local guide.',
        { name: p.name, region: regionSide, operator: SITE.operator },
      ),
    },
    {
      q: t('How long should I spend at {name}?', { name: p.name }),
      a:
        t('Most visitors spend {duration} at {name}.', { duration, name: p.name }) +
        (p.closesAt
          ? ` ${t('It usually closes around {time}, so plan to arrive earlier in the day.', { time: p.closesAt })}`
          : ''),
    },
  ];
  if (p.closesAt) {
    faqs.push({
      q: t('What are the opening hours of {name}?', { name: p.name }),
      a: t(
        '{name} typically closes around {time}. Hours can change on public holidays — message us on WhatsApp to confirm before you travel.',
        { name: p.name, time: p.closesAt },
      ),
    });
  }
  faqs.push(
    {
      q: t('Can I visit {name} on a tour?', { name: p.name }),
      a: t(
        'Yes. {name} can be included on a private {region} sightseeing tour, or you can build a custom day around it with our free AI road-trip planner and book online in minutes.',
        { name: p.name, region: regionLabel },
      ),
    },
    {
      q: t('How do I get to {name} from my hotel?', { name: p.name }),
      a: t(
        'The easiest way is a private transfer with a local driver-guide. {operator} offers door-to-door pickup with transparent, fixed pricing — no metered surprises and no commission stops.',
        { operator: SITE.operator },
      ),
    },
  );
  return faqs;
}
