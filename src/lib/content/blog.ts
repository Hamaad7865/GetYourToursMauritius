import { POSTS_RAW } from './_blog.gen';
import { POSTS_FR } from './_blog.fr.gen';
import { HANDWRITTEN_POSTS, HANDWRITTEN_POSTS_FR } from './blog-handwritten';
import { BLOG_HERO } from './blog-images';
import { localiseContent } from './localise';
import type { Locale } from '@/lib/i18n/config';

/**
 * Blog / travel-guide articles. Raw content is generated into `_blog.gen.ts`; this module
 * types it and stamps deterministic publish dates (no runtime now() so builds are stable).
 */

export interface PostContent {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  readMins: number;
  /** `imageUrl` is an optional illustration under the section heading (admin-written posts only). */
  sections: { heading: string; paragraphs: string[]; imageUrl?: string | null }[];
  faq: { q: string; a: string }[];
  /** Cover photo (admin-written posts only) — hero band, index card thumb, OG/social image. */
  heroImageUrl?: string | null;
}

export interface Post extends PostContent {
  path: string;
  datePublished: string; // YYYY-MM-DD
  /** Set only when the article was really rewritten — never bumped just to look fresh. */
  dateModified?: string; // YYYY-MM-DD
}

/**
 * The fields of a blog post that may be translated. An ALLOWLIST, deliberately — but note the
 * deliberate DIFFERENCE from the area/attraction/transfer guides: an area's `name` is a real place
 * name and stays out of its translation type, whereas a blog post's `title` is our own editorial
 * copy and belongs here. `sections` and `faq` are our own written article body and Q&A, so they
 * translate too — a translated `sections` entry must keep the same number and order of blocks as the
 * English source (pages render them positionally) and only ever set `heading`/`paragraphs` (never
 * `imageUrl`, which is a path, not prose). `slug`, `readMins`, `heroImageUrl` and each section's
 * `imageUrl` are identifiers or paths, never present here. `metaTitle`/`metaDescription` are also
 * left out for now — like `areaMetaTitle`/`attractionMetaTitle`/`transferMetaTitle`, SEO title/meta
 * tags are handled together in the metadata pass, not per content module.
 */
export type PostTranslation = Partial<Pick<PostContent, 'title' | 'excerpt' | 'sections' | 'faq'>>;

/** A post in the visitor's language, falling back to English per field. */
export function localisedPost(post: Post, locale: Locale): Post {
  // Hand-written first: a hand-written post can take over a generated slug, and its own French wins.
  return localiseContent(post, HANDWRITTEN_POSTS_FR[post.slug] ?? POSTS_FR[post.slug], locale);
}

export function blogPath(slug: string): string {
  return `/blog/${slug}`;
}

/** Deterministic publish date per post (newest first, 5 days apart) — no Date.now(), so builds are stable. */
function dateForIndex(i: number): string {
  const base = Date.parse('2026-06-17T00:00:00Z');
  return new Date(base - i * 5 * 86400000).toISOString().slice(0, 10);
}

/**
 * Search-result title/description fixes for seed posts, laid over the generated copy (which is
 * regenerated wholesale, so it can't be hand-edited). Each is driven by Search Console data from
 * 30 Aug – 26 Sep 2026: the post already ranks on page one, but its title doesn't answer the query
 * people actually type, so almost nobody clicks. The root template still appends the brand, so the
 * visible part is written to fit ~45 characters where it can.
 */
export const POST_META_OVERRIDES: Record<
  string,
  Partial<Pick<PostContent, 'metaTitle' | 'metaDescription'>>
> = {
  // "best places to watch sunset" — 788 impressions at #6.6, zero clicks. The generated title also
  // carried the brand itself, so the template printed it twice.
  'sunset-spots-mauritius': {
    metaTitle: 'Best Places to Watch the Sunset in Mauritius',
    metaDescription:
      'The best places to watch the sunset in Mauritius: Le Morne, Tamarin, Flic en Flac and a west-coast sunset catamaran, with timing and season tips.',
  },
  // "can you use euros / dollars in mauritius" — 0.19% CTR, the worst on the site.
  'money-in-mauritius': {
    metaTitle: 'Can You Use Euros or Dollars in Mauritius? Money Guide',
    metaDescription:
      'Euros, dollars or rupees? What to pay with in Mauritius, where cards work, ATMs, tipping and what things really cost, from a local tour operator.',
  },
  // "mauritius arrival card", "mauritius entry form" — the form the article covers in full.
  'mauritius-entry-requirements': {
    metaTitle: 'Mauritius Entry Requirements & Arrival Card Guide',
    metaDescription:
      'Visa-free entry, the All-in-One Travel Form (arrival card), passport and onward-ticket rules: what to do before you fly to Mauritius and at immigration.',
  },
  // "ganga talao" (508) out-searches "grand bassin" (270), so it leads.
  'grand-bassin-guide': {
    metaTitle: 'Ganga Talao (Grand Bassin), Mauritius: Visitor Guide',
  },
  // "markets in mauritius", "flacq market", "port louis market", "best places to shop".
  'mauritius-markets-guide': {
    metaTitle: 'Mauritius Markets: Port Louis, Flacq & Where to Shop',
  },
  // `mauritius-in-december` moved to blog-handwritten.ts on 2026-10-17 and carries its own title.
  // Search Console 1–16 Oct 2026: page-one queries with no clicks at all.
  // "black river gorges national park entry fee" — #5.7, 45 impressions, 0 clicks. The article
  // answers it (entry is free) but the title only said "Hiking Guide".
  'black-river-gorges-guide': {
    metaTitle: 'Black River Gorges National Park: Free Entry & Trails',
    metaDescription:
      'Entry to Black River Gorges National Park is free. The best trails and viewpoints, both entrances, opening times and what to bring, from a local operator.',
  },
  // "is mauritius safe" — #8, 163 impressions, 0 clicks; "is mauritius safe for tourists" #9.7.
  'is-mauritius-safe': {
    metaTitle: 'Is Mauritius Safe for Tourists? An Honest Guide',
    metaDescription:
      'Mauritius is one of the safest islands in the Indian Ocean. What to watch for: sea currents, sun, taxis, petty theft and common scams.',
  },
};

/**
 * French search-result titles/descriptions for seed posts. French pages otherwise title themselves
 * with the post's translated `title`, which says "Maurice" — but French searchers type "île Maurice"
 * ("ile maurice en decembre", "snorkeling ile maurice", "coucher de soleil ile maurice", "plongée ile
 * maurice"), and each of these posts sat on page two or three for exactly that phrase. Kept out of
 * `localisedPost` on purpose: meta is page-layer SEO copy, not article content.
 */
export const POST_META_FR: Record<
  string,
  Partial<Pick<PostContent, 'metaTitle' | 'metaDescription'>>
> = {
  // "ile maurice en decembre" — 383 impressions in September at #26, and rising into the season.
  // "meteo ile maurice decembre" peaks in November (#6 in France on 17 Oct 2026).
  'mauritius-in-december': {
    metaTitle: 'Île Maurice en décembre 2026 : météo, prix et que faire',
    metaDescription:
      'L’île Maurice en décembre 2026 : météo d’été, cyclones, dates des fêtes, prix des excursions et quand réserver. Conseils d’un opérateur local.',
  },
  // "ile maurice en novembre" (590/month in France), "meteo ile maurice novembre" (480).
  'mauritius-in-november': {
    metaTitle: 'Île Maurice en novembre 2026 : météo, mer et que faire',
    metaDescription:
      'L’île Maurice en novembre 2026 : météo du début de l’été, température de la mer, pluie, fêtes et prix des excursions. Conseils d’un opérateur local.',
  },
  // "noel ile maurice", "reveillon ile maurice", "vacances noel ile maurice" (autocomplete, Oct 2026).
  'christmas-and-new-year-in-mauritius': {
    metaTitle: 'Noël et Nouvel An à l’île Maurice 2026 : le guide',
    metaDescription:
      'Noël et réveillon à l’île Maurice en 2026 : ce qui se passe les 24, 25 et 31 décembre, où voir les feux d’artifice, ce qui ferme et que réserver.',
  },
  // "ile maurice en janvier" — 192 impressions at #35 in Sep–Oct 2026 with no page of its own.
  'mauritius-in-january': {
    metaTitle: 'Île Maurice en janvier 2027 : météo, cyclones et que faire',
    metaDescription:
      'L’île Maurice en janvier 2027 : chaleur, pluie et cyclones, mer, Cavadee et Nouvel An, prix des excursions. Conseils d’un opérateur local.',
  },
  'things-to-do-in-mauritius-when-it-rains': {
    metaTitle: 'Que faire à l’île Maurice quand il pleut ?',
    metaDescription:
      'Il pleut à l’île Maurice ? Filez sur la côte ouest, plus sèche, à Port-Louis, à une dégustation de thé ou de rhum, aux musées de Mahébourg ou en sous-marin.',
  },
  // "voyage famille ile maurice" (75 impressions at #43), "ile maurice en famille" (#36), "vacances à
  // l'île maurice en famille" (#30): French families search "en famille", the title said "avec des
  // enfants". The French Christmas school holidays (19 Dec–4 Jan) are when they travel.
  'mauritius-with-kids': { metaTitle: 'Île Maurice en famille : activités et conseils de voyage' },
  'snorkeling-in-mauritius': { metaTitle: 'Snorkeling à l’île Maurice : les meilleurs spots' },
  'sunset-spots-mauritius': {
    metaTitle: 'Coucher de soleil à l’île Maurice : les plus beaux spots',
  },
  'scuba-diving-mauritius': { metaTitle: 'Plongée à l’île Maurice : meilleurs sites et saisons' },
  'private-vs-shared-catamaran-mauritius': {
    metaTitle: 'Catamaran privé ou partagé à l’île Maurice ?',
    metaDescription:
      'Catamaran privé ou partagé à l’île Maurice ? Prix, taille du groupe, itinéraire et déjeuner pour la journée à l’île aux Cerfs : comparez et choisissez.',
  },
};

/**
 * Hand-picked "related articles" for posts where topic matters more than recency, so the links carry
 * readers — and link weight — to the post they are most likely to want next. Anything not listed
 * falls back to the most recent posts.
 *
 * SEASONAL until 2026-12-31: the trip-planning posts lead with `mauritius-in-december` (and the
 * month guide links to the November one) while demand for both peaks. In January, move
 * `best-time-to-visit-mauritius` and the December guide to `mauritius-in-january` and the rainy-day
 * guide, and drop the Christmas post from every list; put the rest back to a year-round pick in
 * February.
 */
export const RELATED_POSTS: Record<string, string[]> = {
  'best-time-to-visit-mauritius': [
    'mauritius-in-december',
    'christmas-and-new-year-in-mauritius',
    'mauritius-in-january',
  ],
  'mauritius-in-november': [
    'mauritius-in-december',
    'christmas-and-new-year-in-mauritius',
    'best-time-to-visit-mauritius',
  ],
  // The festive cluster: the month, its holidays and the month after, each pointing at the others.
  'christmas-and-new-year-in-mauritius': [
    'mauritius-in-december',
    'mauritius-in-january',
    'private-vs-shared-catamaran-mauritius',
  ],
  'mauritius-in-january': [
    'things-to-do-in-mauritius-when-it-rains',
    'mauritius-cyclone-season',
    'christmas-and-new-year-in-mauritius',
  ],
  'things-to-do-in-mauritius-when-it-rains': [
    'mauritius-in-january',
    'port-louis-things-to-do',
    'mauritius-cyclone-season',
  ],
  'mauritius-cyclone-season': [
    'things-to-do-in-mauritius-when-it-rains',
    'mauritius-in-january',
    'mauritius-in-december',
  ],
  'mauritius-with-kids': [
    'christmas-and-new-year-in-mauritius',
    'casela-nature-park-guide',
    'things-to-do-in-mauritius-when-it-rains',
  ],
  'mauritius-entry-requirements': [
    'mauritius-in-december',
    'money-in-mauritius',
    'getting-around-mauritius',
  ],
  'money-in-mauritius': [
    'mauritius-in-december',
    'mauritius-entry-requirements',
    'getting-around-mauritius',
  ],
  'mauritius-in-december': [
    'christmas-and-new-year-in-mauritius',
    'mauritius-in-january',
    'mauritius-in-november',
  ],
  // The catamaran cluster: the private-vs-shared comparison sits between the route guide and the
  // Île aux Cerfs guide, so each of the three points at the other two.
  'private-vs-shared-catamaran-mauritius': [
    'catamaran-cruises-mauritius',
    'ile-aux-cerfs-guide',
    'ile-aux-cerfs-vs-blue-bay',
  ],
  'catamaran-cruises-mauritius': [
    'private-vs-shared-catamaran-mauritius',
    'ile-aux-cerfs-guide',
    'swimming-with-dolphins-mauritius',
  ],
  'ile-aux-cerfs-guide': [
    'private-vs-shared-catamaran-mauritius',
    'catamaran-cruises-mauritius',
    'ile-aux-cerfs-vs-blue-bay',
  ],
  // The south-west circuit: one day trip, four guides that should point at each other.
  'grand-bassin-guide': ['black-river-gorges-guide', 'tamarind-falls-guide', 'chamarel-guide'],
  'black-river-gorges-guide': ['grand-bassin-guide', 'chamarel-guide', 'tamarind-falls-guide'],
  'tamarind-falls-guide': ['grand-bassin-guide', 'black-river-gorges-guide', 'chamarel-guide'],
  'chamarel-guide': ['black-river-gorges-guide', 'grand-bassin-guide', 'tamarind-falls-guide'],
};

// A generated post can be taken over by a hand-written one of the same slug (it keeps its URL). It is
// dropped AFTER the dates are stamped, because a generated post's date comes from its index: removing
// it before would move every later post's date by five days.
const handwrittenSlugs = new Set(HANDWRITTEN_POSTS.map((p) => p.slug));

const generatedPosts: Post[] = POSTS_RAW.map((p, i) => ({
  ...p,
  ...POST_META_OVERRIDES[p.slug],
  // Seed posts carry no photo of their own, which left the index a wall of text-only cards and every
  // social share falling back to the site-wide OG image. BLOG_HERO (generated alongside the files in
  // public/blog) fills that in. A post that ever ships its own hero keeps it, and an admin-written DB
  // post replaces the whole seed anyway (blog-live.ts), so this never overrides real editorial choice.
  heroImageUrl: p.heroImageUrl ?? BLOG_HERO[p.slug] ?? null,
  path: blogPath(p.slug),
  datePublished: dateForIndex(i),
})).filter((p) => !handwrittenSlugs.has(p.slug));

/** Hand-written posts (blog-handwritten.ts) carry their own real publish date and hero. */
export const posts: Post[] = [
  ...HANDWRITTEN_POSTS.map((p) => ({ ...p, path: blogPath(p.slug) })),
  ...generatedPosts,
].sort((a, b) => b.datePublished.localeCompare(a.datePublished));

export function getPost(slug: string): Post | null {
  return posts.find((p) => p.slug === slug) ?? null;
}

export function relatedPosts(slug: string, n = 3): Post[] {
  return posts.filter((p) => p.slug !== slug).slice(0, n);
}

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** Human date like "17 June 2026" (French: "17 juin 2026", "1er juin 2026"). */
export function formatPostDate(iso: string, locale: Locale = 'en'): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (locale === 'fr') return `${d === 1 ? '1er' : d} ${MONTHS_FR[(m ?? 1) - 1]} ${y}`;
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}
