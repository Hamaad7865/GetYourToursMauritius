/**
 * Static stand-in packages for the /photo-demo flow — same shape the real /photography page
 * builds from the catalogue (packages-data.ts), so the demo can be swapped for live data later.
 * Prices/details are illustrative.
 */
export interface DemoAddOn {
  name: string;
  priceEur: number;
}

export interface DemoPackage {
  slug: string;
  category: string;
  title: string;
  mood: string;
  summary: string;
  durationLabel: string;
  meta: string;
  photoCount: number;
  delivery: string;
  location: string;
  priceEur: number;
  rating: number;
  reviews: number;
  bestSeller?: boolean;
  isNew?: boolean;
  image: string;
  gallery: { src: string; caption: string }[];
  features: string[];
  includes: string[];
  addOns: DemoAddOn[];
}

export const DEMO_PACKAGES: DemoPackage[] = [
  {
    slug: 'the-beach-wedding',
    category: 'Weddings',
    title: 'The Beach Wedding',
    mood: 'Your vow, the lagoon, the last light.',
    summary:
      'From getting-ready to the last light over the lagoon. Two shooters, a drone when the wind allows, and a sneak peek within 48 hours so you can announce it properly.',
    durationLabel: 'Half day (4 hours)',
    meta: 'Half day · two shooters · sneak peek in 48 h',
    photoCount: 250,
    delivery: 'Sneak peek in 48 h, full gallery in 10 days',
    location: 'Your venue, or we suggest a beach',
    priceEur: 590,
    rating: 4.9,
    reviews: 86,
    bestSeller: true,
    image: '/photography/wedding-couple.jpg',
    gallery: [
      { src: '/photography/wedding-sunset.jpg', caption: 'Belle Mare · golden hour' },
      { src: '/photography/wedding-beach.jpg', caption: 'Belle Mare · 6:12 pm' },
      { src: '/photography/wedding-detail.jpg', caption: 'The details table' },
    ],
    features: ['250+ edited photos', 'Highlights film', 'Drone when wind allows'],
    includes: [
      'Pre-wedding call to plan locations and light',
      'Two photographers for the ceremony and cocktail',
      'Private online gallery, full resolution, yours to keep',
      '60-second teaser reel for sharing',
    ],
    addOns: [
      { name: 'Drone aerials', priceEur: 120 },
      { name: 'Extra hour of coverage', priceEur: 90 },
      { name: 'Highlights film (2–3 min)', priceEur: 150 },
    ],
  },
  {
    slug: 'honeymoon-golden-hour',
    category: 'Couples',
    title: 'Honeymoon & Golden Hour',
    mood: 'Ninety minutes at the island’s best hour.',
    summary:
      'Barefoot on Belle Mare beach, or we meet you at your resort. Ninety unhurried minutes at the hour the island does its best work — edited and delivered within 5 days.',
    durationLabel: '1.5 hours',
    meta: '1.5 hours · sunset slot · at your resort or Belle Mare',
    photoCount: 40,
    delivery: 'Edited gallery in 5 days',
    location: 'Belle Mare beach or your resort',
    priceEur: 190,
    rating: 5.0,
    reviews: 64,
    image: '/photography/couple.jpg',
    gallery: [
      { src: '/photography/couple.jpg', caption: 'Honeymoon · day three' },
      { src: '/photography/wedding-sunset.jpg', caption: 'Golden hour, Belle Mare' },
      { src: '/photography/family-2.jpg', caption: 'Trou d’Eau Douce · morning' },
    ],
    features: ['40 edited photos', 'Location advice', 'Delivered in 5 days'],
    includes: [
      'Location advice matched to the season’s light',
      'Gentle direction if you’ve never been photographed',
      'Private online gallery, full resolution',
      'Fits between excursions — no half-day lost',
    ],
    addOns: [
      { name: 'Extra hour of coverage', priceEur: 70 },
      { name: 'Drone aerials', priceEur: 120 },
    ],
  },
  {
    slug: 'the-whole-crew',
    category: 'Families',
    title: 'The Whole Crew',
    mood: 'Everyone in one frame, finally.',
    summary:
      'Grandparents, toddlers, the works. We shoot early before the heat, keep it playful, and bribe nobody — the smiles are real.',
    durationLabel: '2 hours',
    meta: '2 hours · early before the heat · kids welcome',
    photoCount: 60,
    delivery: 'Edited gallery in 5 days',
    location: 'Your resort beach or Palmar',
    priceEur: 220,
    rating: 4.8,
    reviews: 52,
    image: '/photography/family.jpg',
    gallery: [
      { src: '/photography/family.jpg', caption: 'Palmar · 8:15 am' },
      { src: '/photography/family-2.jpg', caption: 'Trou d’Eau Douce · 9:40 am' },
      { src: '/photography/couple.jpg', caption: 'The parents, five minutes alone' },
    ],
    features: ['60 edited photos', 'Group + candid shots', 'Print-ready files'],
    includes: [
      'Group shots plus the candid in-between moments',
      'Shade and water breaks built in',
      'Print-ready files for the wall back home',
      'Private online gallery, full resolution',
    ],
    addOns: [
      { name: 'Extra family group (per 5 guests)', priceEur: 40 },
      { name: 'Extra hour of coverage', priceEur: 70 },
    ],
  },
  {
    slug: 'films-and-drone',
    category: 'Film & drone',
    title: 'Films & Drone',
    mood: 'The day, with a soundtrack.',
    summary:
      'A two-to-three-minute film of your day, cut to music you actually like, plus aerials of the reef from above. Add it to any collection or book it standalone.',
    durationLabel: 'Half day',
    meta: 'Add-on or standalone · 4K · licensed pilot',
    photoCount: 0,
    delivery: 'Film in 7 days, teaser in 48 h',
    location: 'Anywhere on the east coast',
    priceEur: 290,
    rating: 5.0,
    reviews: 21,
    isNew: true,
    image: '/photography/film-2.jpg',
    gallery: [
      { src: '/photography/film.jpg', caption: 'From the film' },
      { src: '/photography/film-2.jpg', caption: 'Aerials over the reef' },
      { src: '/photography/wedding-couple.jpg', caption: 'The frames between' },
    ],
    features: ['2–3 min signature film', 'Colour-graded 4K', 'Vertical cut included'],
    includes: [
      'Cinematic edit, colour-graded',
      'Drone footage where flight rules allow',
      'Vertical cut for your stories included',
      'Licensed, insured drone pilot',
    ],
    addOns: [
      { name: 'Extended 5-minute cut', priceEur: 110 },
      { name: 'Raw footage handover', priceEur: 60 },
    ],
  },
  {
    slug: 'the-proposal',
    category: 'Couples',
    title: 'The Proposal',
    mood: 'She says yes. We’re already shooting.',
    summary:
      'We help you plan the where and the when, hide until the moment, then shoot the celebration after. Total secrecy, total chaos, beautiful photos.',
    durationLabel: '1 hour',
    meta: '1 hour · secret planning call included',
    photoCount: 30,
    delivery: 'Sneak peek same evening, gallery in 3 days',
    location: 'Planned together, kept secret',
    priceEur: 240,
    rating: 5.0,
    reviews: 38,
    image: '/photography/wedding-detail.jpg',
    gallery: [
      { src: '/photography/wedding-detail.jpg', caption: 'The ring, the detail' },
      { src: '/photography/couple.jpg', caption: 'Right after the yes' },
      { src: '/photography/wedding-sunset.jpg', caption: 'Celebration at golden hour' },
    ],
    features: ['30 edited photos', 'Secret planning call', 'Same-evening sneak peek'],
    includes: [
      'Planning call to pick the spot and the story',
      'Photographer hidden until the moment',
      'Mini celebration shoot after the yes',
      'Sneak peek the same evening',
    ],
    addOns: [
      { name: 'Drone overhead shot', priceEur: 120 },
      { name: 'Champagne & flowers setup', priceEur: 80 },
    ],
  },
  {
    slug: 'family-and-film-day',
    category: 'Families',
    title: 'Family + Film Day',
    mood: 'The photos and the moving pictures.',
    summary:
      'The Whole Crew shoot with a filmmaker alongside — stills for the wall, a short film for the group chat.',
    durationLabel: '3 hours',
    meta: '3 hours · photographer + filmmaker',
    photoCount: 80,
    delivery: 'Photos in 5 days, film in 7 days',
    location: 'Your resort beach or Palmar',
    priceEur: 380,
    rating: 4.9,
    reviews: 17,
    image: '/photography/family-2.jpg',
    gallery: [
      { src: '/photography/family-2.jpg', caption: 'Trou d’Eau Douce · 9:40 am' },
      { src: '/photography/film.jpg', caption: 'From the family film' },
      { src: '/photography/family.jpg', caption: 'Palmar · 8:15 am' },
    ],
    features: ['80 edited photos', '2 min family film', 'Two shooters'],
    includes: [
      'Photographer and filmmaker working together',
      'Group shots, candids and a short film',
      'Shade and water breaks built in',
      'Private online gallery, full resolution',
    ],
    addOns: [{ name: 'Extended 5-minute film', priceEur: 110 }],
  },
];

export function getDemoPackage(slug: string): DemoPackage | undefined {
  return DEMO_PACKAGES.find((p) => p.slug === slug);
}
