/**
 * Which of our tours a guide page should send its reader to.
 *
 * The attraction pages, area guides and blog posts earn about two thirds of the site's search
 * impressions, and until this existed they passed none of it on: a crawl on 2026-10-13 found 0 of 69
 * attraction pages and 4 of 45 blog posts linking a specific tour. Their one button went to the bare
 * `/activities` listing. The seaplane page — the top-earning tour page — had eight inbound links in
 * total and not one from the Le Morne or underwater-waterfall content that describes it.
 *
 * Hand-listed, like ATTRACTION_LINKS: a card on an attraction page is a promise that the tour goes
 * there. Every pairing below comes from the tour's own itinerary stops in the catalogue, or — for a
 * single-location activity with no itinerary — from the place its own page names (Oct 2026).
 *
 * Slugs are catalogue data, so nothing here can be checked at build time. The page resolves them
 * through `activitiesBySlug`, which returns only tours that are published right now: an unpublished
 * or renamed tour quietly drops out instead of rendering a dead link.
 *
 * Dependency-free on purpose (plain data), so a test or a client component can import it.
 */

/** Attraction id → tours that go there, best fit first. The page shows the first three it finds. */
export const ATTRACTION_TOURS: Readonly<Record<string, readonly string[]>> = {
  // East — Île aux Cerfs and the lagoon
  'ile-aux-cerfs': [
    'catamaran-cruise-ile-aux-cerfs',
    'the-blue-cruise-ile-aux-cerfs-5-islands-visit',
    'speed-boat-ile-aux-cerfs',
    'private-full-day-catamaran-ile-aux-cerfs',
  ],
  'grand-river-south-east-waterfall': [
    'catamaran-cruise-ile-aux-cerfs',
    'the-blue-cruise-ile-aux-cerfs-5-islands-visit',
    'private-full-day-speed-boat-ile-aux-cerf-with-lunch',
  ],
  'trou-deau-douce': [
    'catamaran-cruise-ile-aux-cerfs',
    'the-blue-cruise-ile-aux-cerfs-5-islands-visit',
    'private-full-day-catamaran-ile-aux-cerfs',
  ],
  'ile-aux-aigrettes': [
    'the-blue-cruise-ile-aux-cerfs-5-islands-visit',
    'private-full-day-5-islands-tour-ile-aux-cerfs-with-lunch',
    'private-luxury-speedboat-5-island',
  ],
  'blue-bay-marine-park': ['private-south-east-tour'],
  mahebourg: ['private-south-east-tour'],
  'mahebourg-naval-museum': ['private-south-east-tour'],

  // North — the islets and the beaches
  'ilot-gabriel-island': [
    'catamaran-cruise-3-northern-island-adventure',
    'flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only',
    'private-full-day-3-northern-islands-adventure',
  ],
  'coin-de-mire-island': [
    'catamaran-cruise-3-northern-island-adventure',
    'flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only',
    'private-full-day-3-northern-islands-adventure',
  ],
  'grand-baie-beach': [
    'north-tour',
    'north-beaches-tour',
    'catamaran-cruise-3-northern-island-adventure',
  ],
  'pereybere-beach': ['north-beaches-tour'],
  'mont-choisy-beach': ['north-beaches-tour'],
  'trou-aux-biches-beach': ['north-beaches-tour', 'blue-safari-submarine-subscooter'],
  'cap-malheureux-church': ['north-tour', 'north-beaches-tour'],
  'pamplemousses-botanical-garden': ['north-tour'],
  'port-louis-central-market': ['north-tour'],
  'bain-boeuf-beach': ['private-full-day-3-northern-island-speed-boat-with-lunch-bbq'],

  // South and the highlands
  'trou-aux-cerfs': ['south-tour-mauritius'],
  'grand-bassin-ganga-talao': ['south-tour-mauritius'],
  'chamarel-seven-coloured-earth': ['south-tour-mauritius'],
  'chamarel-waterfall': ['south-tour-mauritius'],
  'black-river-gorges-viewpoint': ['south-tour-mauritius', 'black-river-gorges-hiking'],
  'black-river-gorges-national-park': ['black-river-gorges-hiking', 'south-tour-mauritius'],
  'tamarind-falls': ['hiking-at-the-tamarind-falls-7-cascade'],
  'la-vanille-nature-park': ['tea-tasting-tour'],
  'bois-cheri-tea-plantation': ['tea-tasting-tour'],
  'domaine-de-saint-aubin': ['tea-tasting-tour'],
  'gris-gris': ['tea-tasting-tour'],

  // West — Le Morne, Tamarin and the dolphin coast
  'le-morne-brabant': ['hiking-le-morne', 'seaplane', 'helicotour'],
  'le-morne-beach': ['hiking-le-morne'],
  'ile-aux-benitiers': [
    'swimming-with-dolphins-benitier-island-speedboat-all-inclusive',
    'western-cruise-catamaran',
    'private-full-day-dolphin-swimming-ile-aux-benitiers-with-lunch',
  ],
  'crystal-rock': [
    'swimming-with-dolphins-benitier-island-speedboat-all-inclusive',
    'western-cruise-catamaran',
    'private-full-day-dolphin-swimming-ile-aux-benitiers-with-lunch',
  ],
  'riviere-noire-black-river': [
    'western-cruise-catamaran',
    'private-full-day-western-cruise-catamaran',
  ],
  'tamarin-beach': [
    'swimming-with-dolphins',
    'private-swimming-with-dolphins-only',
    'encountering-the-whales-and-swim-with-dolphins-excursion',
  ],
  'casela-nature-parks': ['casela-world-of-adventures'],
};

/** Blog post slug → the tours that post is about, best fit first. */
export const POST_TOURS: Readonly<Record<string, readonly string[]>> = {
  // December is a month for the water: the trips the guide recommends booking ahead.
  'mauritius-in-december': [
    'catamaran-cruise-ile-aux-cerfs',
    'swimming-with-dolphins',
    'the-blue-cruise-ile-aux-cerfs-5-islands-visit',
  ],
  // November: calm seas and cool mornings — a boat day, the dolphins and a hike.
  'mauritius-in-november': [
    'catamaran-cruise-ile-aux-cerfs',
    'swimming-with-dolphins',
    'hiking-le-morne',
  ],
  // The festive fortnight: a lagoon day, an evening for two, the city lights.
  'christmas-and-new-year-in-mauritius': [
    'catamaran-cruise-ile-aux-cerfs',
    'catamaran-sunset-cruise',
    'port-louis-city-tour',
  ],
  // January: the water in the morning, something for a showery day.
  'mauritius-in-january': [
    'catamaran-cruise-ile-aux-cerfs',
    'blue-safari-submarine-subscooter',
    'tea-tasting-tour',
  ],
  'things-to-do-in-mauritius-when-it-rains': [
    'port-louis-city-tour',
    'tea-tasting-tour',
    'private-south-east-tour',
  ],
  'things-to-do-in-mauritius': [
    'catamaran-cruise-ile-aux-cerfs',
    'swimming-with-dolphins',
    'seaplane',
  ],
  'best-waterfalls-in-mauritius': [
    'hiking-at-the-tamarind-falls-7-cascade',
    'south-tour-mauritius',
    'seaplane',
  ],
  'mauritius-7-day-itinerary': [
    'south-tour-mauritius',
    'catamaran-cruise-ile-aux-cerfs',
    'north-tour',
  ],
  'swimming-with-dolphins-mauritius': [
    'swimming-with-dolphins',
    'swimming-with-dolphins-benitier-island-speedboat-all-inclusive',
    'private-swimming-with-dolphins-only',
  ],
  'whale-dolphin-watching': [
    'encountering-the-whales-and-swim-with-dolphins-excursion',
    'swimming-with-dolphins',
    'private-swimming-with-dolphins-only',
  ],
  'ile-aux-cerfs-guide': [
    'catamaran-cruise-ile-aux-cerfs',
    'the-blue-cruise-ile-aux-cerfs-5-islands-visit',
    'speed-boat-ile-aux-cerfs',
  ],
  'ile-aux-cerfs-vs-blue-bay': [
    'catamaran-cruise-ile-aux-cerfs',
    'speed-boat-ile-aux-cerfs',
    'private-south-east-tour',
  ],
  'catamaran-cruises-mauritius': [
    'catamaran-cruise-ile-aux-cerfs',
    'catamaran-cruise-3-northern-island-adventure',
    'western-cruise-catamaran',
  ],
  'sunset-spots-mauritius': ['catamaran-sunset-cruise'],
  'mauritius-honeymoon-guide': [
    'catamaran-sunset-cruise',
    'seaplane',
    'private-full-day-catamaran-ile-aux-cerfs',
  ],
  'mauritius-with-kids': [
    'casela-world-of-adventures',
    'blue-safari-submarine-subscooter',
    'catamaran-cruise-ile-aux-cerfs',
  ],
  'north-vs-south-mauritius': ['north-tour', 'south-tour-mauritius'],
  'snorkeling-in-mauritius': [
    'catamaran-cruise-ile-aux-cerfs',
    'catamaran-cruise-3-northern-island-adventure',
    'underwater-sea-walk-excursion',
  ],
  'scuba-diving-mauritius': [
    'scubadiving',
    'underwater-sea-walk-excursion',
    'blue-safari-submarine-subscooter',
  ],
  'hiking-le-morne': ['hiking-le-morne', 'seaplane', 'black-river-gorges-hiking'],
  'black-river-gorges-guide': [
    'black-river-gorges-hiking',
    'south-tour-mauritius',
    'hiking-at-the-tamarind-falls-7-cascade',
  ],
  'tamarind-falls-guide': ['hiking-at-the-tamarind-falls-7-cascade', 'black-river-gorges-hiking'],
  'chamarel-guide': ['south-tour-mauritius'],
  'grand-bassin-guide': ['south-tour-mauritius'],
  'casela-nature-park-guide': ['casela-world-of-adventures'],
  'port-louis-things-to-do': ['port-louis-city-tour', 'north-tour', 'private-shopping-tour'],
  'mauritius-markets-guide': ['north-tour', 'port-louis-city-tour', 'private-shopping-tour'],
  'deep-sea-fishing-mauritius': ['deep-sea-fishing'],
  'day-trips-from-grand-baie': [
    'catamaran-cruise-3-northern-island-adventure',
    'north-tour',
    'north-beaches-tour',
  ],
  'day-trips-from-flic-en-flac': [
    'swimming-with-dolphins',
    'western-cruise-catamaran',
    'casela-world-of-adventures',
  ],
  'best-beaches-in-mauritius': ['north-beaches-tour', 'catamaran-cruise-ile-aux-cerfs'],
};

/**
 * What a post with no tours of its own shows: the three days out most visitors book. The planning
 * posts (safety, money, SIM cards, entry rules) draw the most impressions on the site and are read
 * by people who have not chosen a tour yet.
 */
export const DEFAULT_POST_TOURS: readonly string[] = [
  'catamaran-cruise-ile-aux-cerfs',
  'swimming-with-dolphins',
  'south-tour-mauritius',
];

/** The tours a blog post should show, in order. */
export function toursForPost(slug: string): readonly string[] {
  return POST_TOURS[slug] ?? DEFAULT_POST_TOURS;
}

export interface HubLink {
  href: string;
  /** English and French link text — a phrase searchers type, not "click here". */
  label: { en: string; fr: string };
}

const CATAMARAN_HUB: HubLink = {
  href: '/mauritius-catamaran-cruise',
  label: { en: 'Catamaran cruises in Mauritius', fr: 'Croisières en catamaran à l’île Maurice' },
};
const ILE_AUX_CERFS_HUB: HubLink = {
  href: '/ile-aux-cerfs-tours',
  label: { en: 'Île aux Cerfs tours and day trips', fr: 'Excursions à l’île aux Cerfs' },
};
const DOLPHIN_HUB: HubLink = {
  href: '/dolphin-swim-mauritius',
  label: { en: 'Swim with dolphins in Mauritius', fr: 'Nager avec les dauphins à l’île Maurice' },
};

/**
 * Blog post slug → the landing page that sells what the post describes. The older catamaran guide
 * (1,700 words, the natural supporter of /mauritius-catamaran-cruise) linked that page only through
 * the header and footer every page shares.
 */
export const POST_HUBS: Readonly<Record<string, HubLink>> = {
  'catamaran-cruises-mauritius': CATAMARAN_HUB,
  'sunset-spots-mauritius': CATAMARAN_HUB,
  'snorkeling-in-mauritius': CATAMARAN_HUB,
  'ile-aux-cerfs-guide': ILE_AUX_CERFS_HUB,
  'ile-aux-cerfs-vs-blue-bay': ILE_AUX_CERFS_HUB,
  'swimming-with-dolphins-mauritius': DOLPHIN_HUB,
  'whale-dolphin-watching': DOLPHIN_HUB,
};
