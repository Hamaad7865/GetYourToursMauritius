/**
 * The public pages whose <title> / meta description / OG image are editable from /admin/seo.
 * Each page's `generateMetadata` merges the `seo_meta` override for its path via
 * `overrideMetadata()` (src/lib/seo/override.ts) — adding a path here without wiring the page
 * shows an editor row that does nothing, so keep the two in sync.
 *
 * `defaultTitle` / `defaultDescription` are informational SNAPSHOTS of the built-in metadata,
 * shown as placeholders in the editor so the SEO editor can see what ships when no override is
 * set. They don't feed the pages themselves.
 */
export interface SeoPage {
  path: string;
  label: string;
  defaultTitle: string;
  defaultDescription: string;
}

export const SEO_PAGES: SeoPage[] = [
  {
    path: '/',
    label: 'Homepage',
    defaultTitle: 'Belle Mare Tours — Mauritius Tours, Activities & Airport Taxi',
    defaultDescription:
      'Book Mauritius tours, activities and excursions direct with Belle Mare Tours: catamaran cruises, dolphin swims, island day tours, private sightseeing and airport taxi transfers.',
  },
  {
    path: '/activities',
    label: 'Activities catalogue',
    defaultTitle: 'Mauritius Activities & Tours — Book Online | Belle Mare Tours',
    defaultDescription:
      'Browse and book Mauritius activities and tours direct with Belle Mare Tours — catamaran cruises, dolphin swims, Île aux Cerfs trips, sea walks and private island day tours.',
  },
  {
    path: '/airport-transfers',
    label: 'Airport transfers',
    defaultTitle: 'Mauritius Airport Transfers — Fixed-Price Private Taxi Service (SSR / MRU)',
    defaultDescription:
      'Private airport transfers in Mauritius at a fixed EUR price — door-to-door between SSR International Airport (MRU) and every hotel, Airbnb and cruise port.',
  },
  {
    path: '/rent',
    label: 'Car & scooter rental',
    defaultTitle: 'Car & Scooter Rental in Belle Mare, Mauritius | Belle Mare Tours',
    defaultDescription:
      'Self-drive car and scooter rental for guests staying in the Belle Mare area, Mauritius. Free local delivery, full insurance, unlimited mileage and 24/7 support.',
  },
  {
    path: '/mauritius-tours',
    label: 'Mauritius tours (hub)',
    defaultTitle: 'Mauritius Tours & Day Trips — Book Direct | Belle Mare Tours',
    defaultDescription:
      'Tours in Mauritius booked direct with a licensed local operator — island day trips, catamaran cruises, private sightseeing and more.',
  },
  {
    path: '/belle-mare-tours',
    label: 'Belle Mare Tours (brand page)',
    defaultTitle: 'Belle Mare Tours — Licensed Mauritius Tour Operator',
    defaultDescription:
      'Belle Mare Tours is a licensed Mauritius tour operator on the east coast. Book catamaran cruises, island day tours, dolphin swims and airport transfers direct.',
  },
  {
    path: '/ile-aux-cerfs-tours',
    label: 'Île aux Cerfs tours',
    defaultTitle: 'Île aux Cerfs Tours & Day Trips | Belle Mare Tours',
    defaultDescription:
      'Île aux Cerfs day trips with a licensed local operator — speedboat and catamaran options, GRSE waterfall, barbecue lunch and hotel pickup.',
  },
  {
    path: '/mauritius-catamaran-cruise',
    label: 'Catamaran cruises',
    defaultTitle: 'Mauritius Catamaran Cruise | Belle Mare Tours',
    defaultDescription:
      'Catamaran cruises in Mauritius booked direct — Île aux Cerfs, northern islands and west-coast sails with lunch and snorkelling.',
  },
  {
    path: '/dolphin-swim-mauritius',
    label: 'Dolphin swims',
    defaultTitle: 'Swim with Dolphins in Mauritius | Belle Mare Tours',
    defaultDescription:
      'Swim with wild dolphins off Tamarin Bay with a licensed local operator — early-morning speedboat trips with hotel pickup.',
  },
  {
    path: '/attractions',
    label: 'Attractions (things to do)',
    defaultTitle: 'Things to Do in Mauritius: Top Attractions & Places to Visit',
    defaultDescription:
      'The best things to do in Mauritius — beaches, waterfalls, viewpoints, islands and cultural sights, with local tips from Belle Mare Tours.',
  },
  {
    path: '/things-to-do-in-belle-mare',
    label: 'Things to do in Belle Mare',
    defaultTitle: 'Things to Do in Belle Mare — Best Activities, Beaches & Day Trips',
    defaultDescription:
      'The best things to do in Belle Mare, Mauritius — beach and lagoon activities, Île aux Cerfs boat trips, catamaran cruises, kitesurfing, golf and day tours, from the licensed local operator based right here on the east coast.',
  },
  {
    path: '/destinations',
    label: 'Destinations (area guides)',
    defaultTitle: 'Mauritius Destinations — Area Guides by Region',
    defaultDescription:
      'Guides to Mauritius’ regions and resort areas — where to stay, what to do and how to get around, from a local operator.',
  },
  {
    path: '/blog',
    label: 'Blog index',
    defaultTitle: 'Mauritius Travel Blog — Guides, Tips & Itineraries',
    defaultDescription:
      'Travel guides, tips and itineraries for Mauritius from the local team at Belle Mare Tours.',
  },
  {
    path: '/mauritius-travel-guide',
    label: 'Travel guide (pillar)',
    defaultTitle: 'Mauritius Travel Guide 2026 — Plan the Perfect Trip',
    defaultDescription:
      'Everything you need to plan a Mauritius trip — when to go, where to stay, getting around, and the experiences worth booking.',
  },
  {
    path: '/reviews',
    label: 'Reviews',
    defaultTitle: 'Belle Mare Tours Reviews — 4.8/5 from 1,000+ Guests',
    defaultDescription:
      'Real guest reviews of Belle Mare Tours from TripAdvisor and Google — 4.8/5 across more than a thousand reviews.',
  },
  {
    path: '/about',
    label: 'About',
    defaultTitle: 'About Belle Mare Tours — your local Mauritius tour operator',
    defaultDescription:
      'Meet Belle Mare Tours: a licensed Mauritian tour operator on the east coast, led by veteran driver-guide Noorani.',
  },
  {
    path: '/contact',
    label: 'Contact',
    defaultTitle: 'Contact Belle Mare Tours',
    defaultDescription:
      'Get in touch with Belle Mare Tours in Belle Mare, Mauritius — WhatsApp, phone or email. We reply fast and help you plan the perfect day.',
  },
  {
    path: '/help',
    label: 'Help centre',
    defaultTitle: 'Help centre · Belle Mare Tours',
    defaultDescription:
      'Answers about booking, payment, pickups, vouchers, cancellations and your account with Belle Mare Tours.',
  },
  {
    path: '/ai-road-trip-planner',
    label: 'AI Road Trip Planner',
    defaultTitle: 'AI Road Trip Planner — Build & book your day in Mauritius',
    defaultDescription:
      'Plan a private Mauritius road trip in minutes: pick your stops, see the route and price, and book with a local driver-guide.',
  },
];
