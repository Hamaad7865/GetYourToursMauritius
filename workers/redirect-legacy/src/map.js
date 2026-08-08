/**
 * visitemaurice.com → bellemaretours.com URL map.
 *
 * Source paths are NORMALISED (see normalisePath in index.js): lower-cased, trailing slash stripped,
 * query and hash removed. Targets are paths on the canonical site, never absolute URLs — index.js
 * prefixes the origin, so there is exactly one place that decides the destination host.
 *
 * Built from the old site's five sitemaps (page/post/article/category/language, 167 URLs total) plus
 * the SEO crawl export `www.visitemaurice.com_pages_20260731.xlsx`. Every target was checked once,
 * by hand, against the live catalogue (`activities.slug`, published only) and the code-generated
 * content trees on 2026-07-31.
 *
 * What CI re-checks every run (tests/unit/legacy-redirects.test.ts): blog and destination targets
 * against the generated content trees, static targets against the route list, and that no target is
 * one of the tours that were DRAFT when this was written. What it cannot re-check is whether a tour
 * is still published — the catalogue is in the database, and the unit suite must not depend on one.
 * Re-verify the /activities targets by hand if tours are unpublished or renamed in /admin.
 */

/**
 * LOCALE — the old site was addressable in two languages (French at the root, English under /en/).
 * The new site now is too: French lives under /fr, served by middleware.ts + src/lib/i18n/routing.ts.
 *
 * Until that shipped this was '', because `getLocale()` read the `gytm_lang` COOKIE and a
 * cross-domain redirect cannot set a cookie on the destination — so every French source landed on
 * the English rendering of the right page, losing the French half of the old site's ranking signals.
 *
 * Keep this in step with LOCALE_PREFIX.fr in src/lib/i18n/routing.ts; they describe the same URL
 * space from either side of the domain move, and tests/unit/legacy-redirects.test.ts asserts it.
 */
export const FR_PREFIX = '/fr';

/** Sources whose visitors were reading French. Everything else is treated as English. */
export function isFrenchSource(path) {
  return !path.startsWith('/en/') && path !== '/en';
}

/**
 * Exact path → target path. Ordered by the section of the old site it came from so a future audit
 * can be diffed against a fresh crawl.
 */
export const EXACT = {
  // ── Home ─────────────────────────────────────────────────────────────────────────────────────
  '': '/',
  '/en': '/',
  '/en/home': '/',

  // ── Tour pages, English (/en/<category>/<slug>) ──────────────────────────────────────────────
  // The new catalogue was imported from this very site, so most slugs survive verbatim.
  '/en/ile-aux-cerfs-tours/speed-boat-ile-aux-cerfs': '/activities/speed-boat-ile-aux-cerfs',
  '/en/ile-aux-cerfs-tours/the-blue-cruise-ile-aux-cerfs-5-islands-visit':
    '/activities/the-blue-cruise-ile-aux-cerfs-5-islands-visit',
  '/en/air-activities/seaplane': '/activities/seaplane',
  '/en/air-activities/skydive': '/activities/skydive',
  // Renamed on import: diving-with-bottle-scuba-dive → scubadiving.
  '/en/sea-water-activities/diving-with-bottle-scuba-dive': '/activities/scubadiving',
  '/en/sea-water-activities/blue-safari-submarine-subscooter':
    '/activities/blue-safari-submarine-subscooter',
  '/en/sea-water-activities/visit-to-ambre-island-by-kayak':
    '/activities/visit-to-ambre-island-by-kayak',
  '/en/sea-water-activities/deep-sea-fishing': '/activities/deep-sea-fishing',
  '/en/sea-water-activities/underwater-sea-walk-excursion':
    '/activities/underwater-sea-walk-excursion',
  '/en/sea-water-activities/encountering-the-whales-and-swim-with-dolphins-excursion':
    '/activities/encountering-the-whales-and-swim-with-dolphins-excursion',
  '/en/sea-water-activities/flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only':
    '/activities/flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only',
  // The same tour also existed as a top-level PAGE, not just a post.
  '/en/flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only':
    '/activities/flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only',
  '/en/dolphin-encounter/swimming-with-dolphins': '/activities/swimming-with-dolphins',
  '/en/dolphin-encounter/swimming-with-dolphins-benitier-island-speedboat-all-inclusive':
    '/activities/swimming-with-dolphins-benitier-island-speedboat-all-inclusive',
  // No like-for-like product survived the import — send it to the dolphin landing page, which lists
  // every current dolphin tour, rather than to a near-miss product page.
  '/en/dolphin-encounter/swim-with-dolphins-south-tours-all-inclusive': '/dolphin-swim-mauritius',
  '/en/catamaran-cruises/catamaran-sunset-cruise': '/activities/catamaran-sunset-cruise',
  '/en/catamaran-cruises/western-cruise-catamaran': '/activities/western-cruise-catamaran',
  '/en/catamaran-cruises/catamaran-cruise-3-northern-island-adventure-all-inclusive':
    '/activities/catamaran-cruise-3-northern-island-adventure',
  '/en/catamaran-cruises/catamaran-cruise-ile-aux-cerfs':
    '/activities/catamaran-cruise-ile-aux-cerfs',
  '/en/hiking-activities/black-river-gorges-hiking': '/activities/black-river-gorges-hiking',
  '/en/hiking-activities/hiking-le-morne': '/activities/hiking-le-morne',
  '/en/hiking-activities/hiking-at-the-tamarind-falls-7-cascade':
    '/activities/hiking-at-the-tamarind-falls-7-cascade',
  '/en/sightseeing/casela-world-of-adventures': '/activities/casela-world-of-adventures',
  // `shopping-tour` and `shopping-tour`'s private twin both exist on the new site; only
  // `private-shopping-tour` is PUBLISHED, so the draft one must not be the target.
  '/en/sightseeing/shopping-tour': '/activities/private-shopping-tour',
  '/en/sightseeing/la-vallee-des-couleurs-nature-park-2':
    '/activities/la-vallee-des-couleurs-nature-park-2',
  '/en/sightseeing/south-east-tour': '/activities/private-south-east-tour',
  '/en/sightseeing/south-tour-mauritius': '/activities/south-tour-mauritius',
  '/en/sightseeing/north-tour': '/activities/north-tour',

  // ── Tour pages, French (/<categorie>/<slug>) ─────────────────────────────────────────────────
  '/tour-ile-aux-cerfs/lile-aux-cerfs-bateau-rapide': '/activities/speed-boat-ile-aux-cerfs',
  '/tour-ile-aux-cerfs/traversee-turquoise-ile-aux-cerfs-visite-des-5-iles':
    '/activities/the-blue-cruise-ile-aux-cerfs-5-islands-visit',
  '/activites-aeriennes/hydravion': '/activities/seaplane',
  '/activites-aeriennes/helicotour': '/activities/helicotour',
  '/activites-aeriennes/saut-en-parachute-en-tandem': '/activities/skydive',
  '/activites-en-mer/visite-lile-dambre-en-kayak': '/activities/visit-to-ambre-island-by-kayak',
  '/activites-en-mer/sous-marin-blue-safari-subscooter':
    '/activities/blue-safari-submarine-subscooter',
  '/activites-en-mer/peche-au-gros': '/activities/deep-sea-fishing',
  '/activites-en-mer/activites-sous-leau': '/activities/underwater-sea-walk-excursion',
  '/activites-en-mer/plongee-avec-bouteille-scuba': '/activities/scubadiving',
  '/activites-en-mer/excursion-a-la-rencontre-des-baleines-et-nage-avec-les-dauphins':
    '/activities/encountering-the-whales-and-swim-with-dolphins-excursion',
  '/activites-en-mer/ile-plate-ile-gabriel-et-coin-de-mire-en-hors-bord-en-exclusivite':
    '/activities/flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only',
  '/randonees-activitees/randonnee-dans-les-gorges-de-la-riviere-noire':
    '/activities/black-river-gorges-hiking',
  '/randonees-activitees/randonee-le-morne-brabant': '/activities/hiking-le-morne',
  '/randonees-activitees/randonnee-au-7-cascades-les-cascades-de-tamarin':
    '/activities/hiking-at-the-tamarind-falls-7-cascade',
  // Published without its category parent at some point — indexed, so it needs its own row.
  '/randonee-le-morne-brabant': '/activities/hiking-le-morne',
  '/rencontre-avec-les-dauphins/nage-avec-les-dauphins': '/activities/swimming-with-dolphins',
  '/rencontre-avec-les-dauphins/nage-avec-les-dauphins-et-ilot-benitier-en-bateau-rapide-tout-inclus-2':
    '/activities/swimming-with-dolphins-benitier-island-speedboat-all-inclusive',
  '/rencontre-avec-les-dauphins/nage-avec-les-dauphins-les-couleurs-du-sud':
    '/dolphin-swim-mauritius',
  '/croisieres-en-catamaran/croisiere-ile-aux-cerfs-en-catamaran':
    '/activities/catamaran-cruise-ile-aux-cerfs',
  '/croisieres-en-catamaran/croisiere-catamaran-3-iles-du-nord-tout-inclus':
    '/activities/catamaran-cruise-3-northern-island-adventure',
  '/croisieres-en-catamaran/croisiere-de-louest': '/activities/western-cruise-catamaran',
  '/croisieres-en-catamaran/croisiere-catamaran-au-coucher-du-soleil':
    '/activities/catamaran-sunset-cruise',
  '/visites-guidees/le-nord': '/activities/north-tour',
  '/visites-guidees/le-sud': '/activities/south-tour-mauritius',
  '/visites-guidees/tour-sud-est': '/activities/private-south-east-tour',
  '/visites-guidees/la-vallee-des-couleurs-nature-park':
    '/activities/la-vallee-des-couleurs-nature-park-2',

  // ── Category / hub pages ─────────────────────────────────────────────────────────────────────
  '/en/sightseeing': '/mauritius-tours',
  '/en/catamaran-cruises': '/mauritius-catamaran-cruise',
  '/en/dolphin-encounter': '/dolphin-swim-mauritius',
  '/en/ile-aux-cerfs-tours': '/ile-aux-cerfs-tours',
  '/en/air-activities': '/activities',
  '/en/sea-water-activities': '/activities',
  '/en/hiking-activities': '/activities',
  '/visites-guidees': '/mauritius-tours',
  '/croisieres-en-catamaran': '/mauritius-catamaran-cruise',
  '/rencontre-avec-les-dauphins': '/dolphin-swim-mauritius',
  '/tour-ile-aux-cerfs': '/ile-aux-cerfs-tours',
  '/activites-aeriennes': '/activities',
  '/activites-en-mer': '/activities',
  // The hub was published as `/randonees-activites` while its children sat under the
  // misspelt `/randonees-activitees` — both are live and indexed.
  '/randonees-activites': '/activities',
  '/randonees-activitees': '/activities',

  // ── WordPress category archives ──────────────────────────────────────────────────────────────
  '/category/activites-aeriennes': '/activities',
  '/category/activites-en-mer': '/activities',
  '/category/croisieres-en-catamaran': '/mauritius-catamaran-cruise',
  '/category/randonees-activitees': '/activities',
  '/category/rencontre-avec-les-dauphins': '/dolphin-swim-mauritius',
  '/category/tour-ile-aux-cerfs': '/ile-aux-cerfs-tours',
  '/category/visites-guidees': '/mauritius-tours',
  '/category/blog': '/blog',
  '/en/category/air-activities': '/activities',
  '/en/category/sea-water-activities': '/activities',
  '/en/category/catamaran-cruises': '/mauritius-catamaran-cruise',
  '/en/category/hiking-activities': '/activities',
  '/en/category/dolphin-encounter': '/dolphin-swim-mauritius',
  '/en/category/ile-aux-cerfs-tours': '/ile-aux-cerfs-tours',
  '/en/category/sightseeing': '/mauritius-tours',
  '/en/category/blog-en': '/blog',
  '/en/category/uncategorized': '/blog',

  // ── Transport & rental ───────────────────────────────────────────────────────────────────────
  '/en/airport-transfer': '/airport-transfers',
  '/transfert-aeroport': '/airport-transfers',
  '/en/taxi': '/airport-transfers',
  '/taxi-ile-maurice': '/airport-transfers',
  '/en/car-rental-mauritius': '/rent',
  '/location-voiture-ile-maurice': '/rent',
  '/en/rent-scooter': '/rent',
  '/location-scooter': '/rent',

  // ── Company & policy pages ───────────────────────────────────────────────────────────────────
  '/en/about-us': '/about',
  '/a-propos': '/about',
  '/en/contact-us': '/contact',
  '/contactez-nous': '/contact',
  '/en/cookie-policy': '/cookies',
  '/en/cancellation-policy': '/refunds',
  '/politique-dannulation': '/refunds',
  '/politique-de-confidentialite': '/privacy',
  '/protection-des-donnees': '/privacy',
  '/terms-conditions': '/terms',

  // ── Old WooCommerce shop ─────────────────────────────────────────────────────────────────────
  '/shop': '/activities',
  '/shop/cart': '/cart',
  '/shop/checkout': '/checkout',
  '/shop/account': '/account',
  '/shop/login': '/account',

  // ── Blog indexes ─────────────────────────────────────────────────────────────────────────────
  '/blog': '/blog',
  '/articles': '/blog',
  '/en/articles-2': '/blog',

  // ── Articles (51: every one paired FR/EN) ────────────────────────────────────────────────────
  // Each old article is sent to the new page that already covers the same topic, NOT to /blog —
  // a mass redirect onto an index reads as a soft 404 to Google and inherits nothing.
  '/en/article/mauritius-weather-by-month-august-to-december-guide-2026':
    '/blog/best-time-to-visit-mauritius',
  '/article/meteo-a-lile-maurice-daout-a-decembre-temperatures-etat-de-la-mer-et-meilleures-activites-en-2026':
    '/blog/best-time-to-visit-mauritius',
  '/article/lhiver-a-lile-maurice-guide-regional-de-la-saison-fraiche':
    '/blog/best-time-to-visit-mauritius',
  '/en/article/best-things-to-do-in-mauritius-in-april-and-may-complete-travel-guide-2026':
    '/blog/best-time-to-visit-mauritius',
  '/article/activites-a-faire-en-avril-et-mai-a-lile-maurice-guide-complet-2026':
    '/blog/best-time-to-visit-mauritius',
  '/article/tour-sud-de-lile-maurice-itineraire-complet-et-incontournables-2026':
    '/activities/south-tour-mauritius',
  '/en/article/south-tour-of-mauritius-complete-itinerary-and-must-see-attractions-2026':
    '/activities/south-tour-mauritius',
  '/article/premiere-fois-a-lile-maurice-evitez-ces-15-erreurs-de-touristes':
    '/mauritius-travel-guide',
  '/en/article/first-time-in-mauritius-avoid-these-15-tourist-mistakes': '/mauritius-travel-guide',
  '/article/le-morne-guide-2026-randonnee-plages-et-sports-nautiques': '/destinations/le-morne',
  '/en/article/le-morne-guide-2026-hiking-beaches-water-sports': '/destinations/le-morne',
  '/article/itineraire-de-7-jours-a-lile-maurice-sans-perdre-de-temps-guide-2026':
    '/blog/mauritius-7-day-itinerary',
  '/en/article/mauritius-in-7-days-ultimate-travel-itinerary-for-2026':
    '/blog/mauritius-7-day-itinerary',
  '/en/article/grand-baie-guide-2026-best-activities-restaurants-beaches-nightlife':
    '/destinations/grand-baie',
  '/article/grand-baie-guide-2026-activites-restaurants-plages-et-vie-nocturne':
    '/destinations/grand-baie',
  '/en/article/how-to-book-tours-in-mauritius-in-2026-complete-travel-guide': '/activities',
  '/article/comment-reserver-des-excursions-a-lile-maurice-en-2026-guide-complet': '/activities',
  '/article/ile-aux-cerfs-guide-2026-prix-activites-et-conseils': '/blog/ile-aux-cerfs-guide',
  '/en/article/ile-aux-cerfs-2026-guide-prices-activities-tips': '/blog/ile-aux-cerfs-guide',
  '/article/comment-reserver-votre-visite-privee-de-lile-maurice-avec-chauffeur-guide-7-etapes-essentielles':
    '/mauritius-tours',
  '/en/article/how-to-book-your-private-island-tour-with-chauffeur-guide-7-essential-steps':
    '/mauritius-tours',
  '/article/les-meilleures-excursions-hivernales-a-maurice': '/blog/things-to-do-in-mauritius',
  '/en/article/top-10-winter-excursions-in-mauritius-in-2026-best-things-to-do':
    '/blog/things-to-do-in-mauritius',
  '/en/article/must-list-of-things-to-do-in-mauritius-in-2026-complete-guide':
    '/blog/things-to-do-in-mauritius',
  '/article/les-activites-incontournables-a-faire-a-lile-maurice-en-2026':
    '/blog/things-to-do-in-mauritius',
  '/en/article/rent-a-car-a-scooter-or-take-a-taxi-which-one-should-you-choose':
    '/blog/getting-around-mauritius',
  '/article/louer-une-voiture-un-scooter-ou-soffrir-les-services-dun-taxi-quoi-choisir':
    '/blog/getting-around-mauritius',
  '/en/article/best-way-to-get-around-mauritius-complete-transportation-guide':
    '/blog/getting-around-mauritius',
  '/article/le-meilleur-moyen-de-se-deplacer-a-lile-maurice-guide-complet':
    '/blog/getting-around-mauritius',
  '/en/article/shopping-malls-and-markets-in-mauritius-where-modern-life-meets-local-culture':
    '/blog/mauritius-markets-guide',
  '/article/centres-commerciaux-et-marches-a-lile-maurice-entre-modernite-et-traditions':
    '/blog/mauritius-markets-guide',
  '/article/comment-organiser-des-vacances-en-famille-sans-stress-a-lile-maurice-en-couple-avec-enfants':
    '/blog/mauritius-with-kids',
  '/en/article/stress-free-family-vacation-in-mauritius-travel-with-kids':
    '/blog/mauritius-with-kids',
  '/article/belle-mare-tours-remporte-lexcellence-in-tourism-award-2025': '/about',
  '/en/article/belle-mare-tours-wins-the-excellence-in-tourism-award-2025': '/about',
  '/article/meilleur-tour-operateur-a-lile-maurice-decouvrez-belle-mare-tours': '/about',
  '/en/article/best-tour-operator-in-mauritius-discover-belle-mare-tours': '/about',
  '/en/article/the-new-tourist-tax-in-mauritius-what-you-need-to-know':
    '/blog/mauritius-entry-requirements',
  '/article/maurice-nouvelle-taxe-touristique-2025-infos-exemptions-fonctionnement':
    '/blog/mauritius-entry-requirements',
  '/article/les-ilots-de-lile-maurice': '/blog/best-beaches-in-mauritius',
  '/en/article/the-islets-of-mauritius-a-journey-through-the-lagoons-hidden-paradises':
    '/blog/best-beaches-in-mauritius',
  '/article/nager-avec-les-dauphins-a-lile-maurice-plongez-dans-laventure-avec-belle-mare-tours':
    '/blog/swimming-with-dolphins-mauritius',
  '/en/article/swimming-with-dolphins-in-mauritius-dive-into-adventure-with-belle-mare-tours':
    '/blog/swimming-with-dolphins-mauritius',
  // The Belle Mare guide moved to the bare /belle-mare. Pointed straight at the new URL rather than
  // left on the old one: /destinations/belle-mare still 308s, so the old target would work, but it
  // would make these two the only entries in the map that cost a visitor a second hop.
  '/article/belle-mare-tout-ce-quil-faut-savoir-sur-la-region': '/belle-mare',
  '/en/article/welcome-to-belle-mare-paradise-in-mauritius': '/belle-mare',
  '/en/article/stopovers-in-mauritius-top-excursions-cruise-ship': '/activities',
  '/article/escales-ile-maurice-les-top-excursions-bateau-croisiere': '/activities',
  '/article/mettez-les-voiles-au-paradis-la-beaute-des-croisieres-en-catamaran-a-lile-maurice':
    '/blog/catamaran-cruises-mauritius',
  '/en/article/set-sail-in-paradise-the-beauty-of-catamaran-cruises-in-mauritius':
    '/blog/catamaran-cruises-mauritius',
  '/en/article/5-reasons-to-book-a-sunset-cruise-in-mauritius':
    '/activities/catamaran-sunset-cruise',
  '/article/5-raisons-de-reserver-une-croisiere-au-coucher-du-soleil-a-lile-maurice':
    '/activities/catamaran-sunset-cruise',

  // ── Legacy flat permalinks (no category segment) ─────────────────────────────────────────────
  // An earlier permalink structure that WordPress no longer links to and that is therefore absent
  // from every sitemap — but the SEO crawl found all of these still indexed. Without these rows they
  // fall through to the home page, which is precisely the soft-404 outcome the map exists to avoid.
  '/helicotour': '/activities/helicotour',
  '/activites-sous-leau': '/activities/underwater-sea-walk-excursion',
  '/plonger-avec-bouteille-scuba-dive': '/activities/scubadiving',
  '/croisiere-de-louest': '/activities/western-cruise-catamaran',
  '/croisiere-ile-aux-cerfs-en-catamaran': '/activities/catamaran-cruise-ile-aux-cerfs',
  '/croisiere-catamaran-3-iles-du-nord-tout-inclus':
    '/activities/catamaran-cruise-3-northern-island-adventure',
  '/lile-aux-cerfs-bateau-rapide': '/activities/speed-boat-ile-aux-cerfs',
  '/traversee-turquoise-ile-aux-cerfs-visite-des-5-iles':
    '/activities/the-blue-cruise-ile-aux-cerfs-5-islands-visit',
  '/la-vallee-des-couleurs-nature-park': '/activities/la-vallee-des-couleurs-nature-park-2',
  '/nage-avec-les-dauphins': '/activities/swimming-with-dolphins',
  '/nage-avec-les-dauphins-les-couleurs-du-sud': '/dolphin-swim-mauritius',
  '/randonnee-dans-les-gorges-de-la-riviere-noire': '/activities/black-river-gorges-hiking',
  // Misspelt in the CMS ("monde" for "morne") and indexed that way.
  '/randonee-au-monde-brabant': '/activities/hiking-le-morne',
  '/location-vehicule': '/rent',
  '/visites-guidees/casela-world-of-adventures-parc-dattraction':
    '/activities/casela-world-of-adventures',
  '/visites-guidees/shopping': '/activities/private-shopping-tour',
  '/en/helicotour-2': '/activities/helicotour',
  '/en/underwater-sea-walk-excursion': '/activities/underwater-sea-walk-excursion',
  '/en/diving-with-bottle-scuba-dive': '/activities/scubadiving',
  '/en/western-cruise-catamaran': '/activities/western-cruise-catamaran',
  '/en/catamaran-cruise-ile-aux-cerfs': '/activities/catamaran-cruise-ile-aux-cerfs',
  '/en/catamaran-cruise-3-northern-island-adventure-all-inclusive':
    '/activities/catamaran-cruise-3-northern-island-adventure',
  '/en/speed-boat-ile-aux-cerfs': '/activities/speed-boat-ile-aux-cerfs',
  '/en/the-blue-cruise-ile-aux-cerfs-5-islands-visit':
    '/activities/the-blue-cruise-ile-aux-cerfs-5-islands-visit',
  '/en/la-vallee-des-couleurs-nature-park-2': '/activities/la-vallee-des-couleurs-nature-park-2',
  '/en/swimming-with-dolphins': '/activities/swimming-with-dolphins',
  '/en/swim-with-dolphins-south-tours-all-inclusive': '/dolphin-swim-mauritius',
  '/en/black-river-gorges-hiking': '/activities/black-river-gorges-hiking',
  '/en/hiking-le-morne': '/activities/hiking-le-morne',

  // ── WordPress scaffolding that was crawlable but worthless ───────────────────────────────────
  '/sample-page': '/',
  '/maintenance': '/',
  '/demo-design-system': '/',
};

/**
 * Longest-prefix fallbacks for paths that are NOT in EXACT — paginated archives (`/page/2`), feed
 * URLs, tag pages, and anything published after the crawl. Checked longest-first, so `/en/article/x`
 * beats `/en`.
 */
export const PREFIXES = [
  ['/en/article', '/blog'],
  ['/article', '/blog'],
  ['/en/category', '/blog'],
  ['/category', '/blog'],
  ['/en/sightseeing', '/mauritius-tours'],
  ['/en/catamaran-cruises', '/mauritius-catamaran-cruise'],
  ['/en/dolphin-encounter', '/dolphin-swim-mauritius'],
  ['/en/ile-aux-cerfs-tours', '/ile-aux-cerfs-tours'],
  ['/en/air-activities', '/activities'],
  ['/en/sea-water-activities', '/activities'],
  ['/en/hiking-activities', '/activities'],
  ['/visites-guidees', '/mauritius-tours'],
  ['/croisieres-en-catamaran', '/mauritius-catamaran-cruise'],
  ['/rencontre-avec-les-dauphins', '/dolphin-swim-mauritius'],
  ['/tour-ile-aux-cerfs', '/ile-aux-cerfs-tours'],
  ['/activites-aeriennes', '/activities'],
  ['/activites-en-mer', '/activities'],
  ['/randonees-activitees', '/activities'],
  ['/randonees-activites', '/activities'],
  ['/shop', '/activities'],
  ['/en', '/'],
];
