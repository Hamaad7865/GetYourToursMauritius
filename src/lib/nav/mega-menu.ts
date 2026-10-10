import { ATTRACTION_IMAGES } from '@/lib/content/_attraction-images.gen';
import { proxiedImageSrc, wikimediaThumb } from '@/lib/content/wikimedia';

/* What the header's two menus ("Places to see", "Things to do") list.
 *
 * Everything here is a page that already exists. The lists are written out by hand rather than
 * derived, because the modules they would be derived from are too heavy to ship to a browser for a
 * menu: the area guides and the attraction guide each carry their full text in two languages.
 * tests/unit/mega-menu.test.ts holds the two in step — an area guide that is added, renamed or moved
 * fails there until this file follows.
 *
 * Loaded only when a menu is first opened (see MainNav), so none of it is in the page's initial
 * JavaScript or HTML.
 *
 * Labels marked `translate` are UI copy and go through t(); the rest are place names and are not
 * translated.
 */

export interface MenuLink {
  label: string;
  href: string;
  /** A small photo of the place. Without one the link shows a pin tile instead. */
  thumb?: string;
  translate?: boolean;
}

export interface MenuGroup {
  id: string;
  /** Always UI copy: passed through t(). */
  label: string;
  links: MenuLink[];
  /** The "see everything" link under the group's grid. */
  more?: MenuLink;
}

/** Menu thumbnails are drawn at 36px; 120 is Wikimedia's nearest standard size for a 2x screen. */
const THUMB_WIDTH = 120;

function sight(slug: string, label: string): MenuLink {
  const image = ATTRACTION_IMAGES[slug];
  return {
    label,
    href: `/attractions/${slug}`,
    ...(image ? { thumb: proxiedImageSrc(wikimediaThumb(image.url, THUMB_WIDTH)) } : {}),
  };
}

/**
 * The attraction types, in menu order. `category` is the value stored on a place (planner_places);
 * `slug` is what /attractions reads from `?type=`. The page imports this list, so a type that is in
 * the menu is always one the page can filter by.
 */
export const ATTRACTION_TYPES: { slug: string; category: string; label: string }[] = [
  { slug: 'beach', category: 'Beach', label: 'Beaches' },
  { slug: 'island', category: 'Island', label: 'Islands' },
  { slug: 'waterfall', category: 'Waterfall', label: 'Waterfalls' },
  { slug: 'viewpoint', category: 'Viewpoint', label: 'Viewpoints' },
  { slug: 'nature', category: 'Nature', label: 'Nature & wildlife' },
  { slug: 'culture', category: 'Culture', label: 'Culture & heritage' },
  { slug: 'garden', category: 'Garden', label: 'Gardens' },
  { slug: 'market', category: 'Market', label: 'Markets' },
  { slug: 'landmark', category: 'Landmark', label: 'Landmarks' },
  { slug: 'food', category: 'Food', label: 'Food & drink' },
];

/** The id each region's section carries on /attractions, so "By coast" can jump straight to it. */
export function regionAnchor(region: string): string {
  return region.toLowerCase();
}

/** Area guides, north to south-west round the coast. Belle Mare's guide lives at a top-level URL. */
const AREAS: { slug: string; name: string }[] = [
  { slug: 'grand-baie', name: 'Grand Baie' },
  { slug: 'pereybere', name: 'Pereybère' },
  { slug: 'cap-malheureux', name: 'Cap Malheureux' },
  { slug: 'grande-gaube', name: 'Grande Gaube' },
  { slug: 'trou-aux-biches', name: 'Trou aux Biches' },
  { slug: 'mont-choisy', name: 'Mont Choisy' },
  { slug: 'pointe-aux-piments', name: 'Pointe aux Piments' },
  { slug: 'balaclava', name: 'Balaclava' },
  { slug: 'port-louis', name: 'Port Louis' },
  { slug: 'belle-mare', name: 'Belle Mare' },
  { slug: 'trou-deau-douce', name: "Trou d'Eau Douce" },
  { slug: 'blue-bay', name: 'Blue Bay & Mahébourg' },
  { slug: 'bel-ombre', name: 'Bel Ombre' },
  { slug: 'le-morne', name: 'Le Morne' },
  { slug: 'tamarin', name: 'Tamarin' },
  { slug: 'flic-en-flac', name: 'Flic-en-Flac' },
];

export const PLACES_MENU: MenuGroup[] = [
  {
    id: 'top-sights',
    label: 'Top sights',
    links: [
      sight('ile-aux-cerfs', 'Île aux Cerfs'),
      sight('chamarel-seven-coloured-earth', 'Seven Coloured Earth'),
      sight('le-morne-brabant', 'Le Morne Brabant'),
      sight('belle-mare-beach', 'Belle Mare Beach'),
      sight('black-river-gorges-national-park', 'Black River Gorges'),
      sight('grand-bassin-ganga-talao', 'Grand Bassin (Ganga Talao)'),
      sight('pamplemousses-botanical-garden', 'Pamplemousses Botanical Garden'),
      sight('chamarel-waterfall', 'Chamarel Waterfall'),
      sight('trou-aux-cerfs', 'Trou aux Cerfs'),
      sight('port-louis-central-market', 'Port Louis Central Market'),
      sight('ile-aux-aigrettes', 'Île aux Aigrettes'),
      sight('blue-bay-marine-park', 'Blue Bay Marine Park'),
      sight('ile-aux-benitiers', 'Île aux Bénitiers'),
      sight('crystal-rock', 'Crystal Rock'),
      sight('casela-nature-parks', 'Casela Nature Parks'),
      sight('tamarind-falls', 'Tamarind Falls'),
      sight('cap-malheureux-church', 'Cap Malheureux'),
      sight('coin-de-mire-island', 'Coin de Mire'),
    ],
    more: { label: 'See all attractions', href: '/attractions', translate: true },
  },
  {
    id: 'types',
    label: 'Attraction types',
    links: ATTRACTION_TYPES.map((type) => ({
      label: type.label,
      href: `/attractions?type=${type.slug}`,
      translate: true,
    })),
  },
  {
    id: 'areas',
    label: 'Areas',
    links: AREAS.map((area) => ({
      label: area.name,
      href: area.slug === 'belle-mare' ? '/belle-mare' : `/destinations/${area.slug}`,
    })),
    more: { label: 'See all areas', href: '/destinations', translate: true },
  },
  {
    id: 'coasts',
    label: 'By coast',
    links: [
      { region: 'North', label: 'North coast' },
      { region: 'East', label: 'East coast' },
      { region: 'South', label: 'South coast' },
      { region: 'West', label: 'West coast' },
      { region: 'Central', label: 'Central plateau' },
    ].map(({ region, label }) => ({
      label,
      href: `/attractions#${regionAnchor(region)}`,
      translate: true,
    })),
  },
];

/**
 * "Things to do" minus its first group. The tour categories are managed in the database and arrive
 * through useCategories(), so the menu component puts that group in front of these two.
 */
export const THINGS_MENU_STATIC: MenuGroup[] = [
  {
    id: 'getting-around',
    label: 'Getting around',
    links: [
      { label: 'Airport transfers', href: '/airport-transfers', translate: true },
      { label: 'Car & scooter rental', href: '/rent', translate: true },
      { label: 'AI Trip Planner', href: '/ai-road-trip-planner', translate: true },
    ],
  },
  {
    id: 'guides',
    label: 'Guides',
    links: [
      { label: 'Mauritius tours', href: '/mauritius-tours', translate: true },
      { label: 'Things to do in Mauritius', href: '/attractions', translate: true },
      { label: 'Mauritius travel guide', href: '/mauritius-travel-guide', translate: true },
      { label: 'Things to do in Belle Mare', href: '/things-to-do-in-belle-mare', translate: true },
      { label: 'Mauritius travel blog', href: '/blog', translate: true },
      { label: 'Guest reviews', href: '/reviews', translate: true },
    ],
  },
];
