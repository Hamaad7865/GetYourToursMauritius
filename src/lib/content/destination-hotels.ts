/**
 * Described hotels for a destination guide — the upgrade from `AreaContent.stayOptions`, which is a
 * bare list of names rendered as pills.
 *
 * WHY THIS EXISTS. /destinations/belle-mare is the page Google already cites for the query "belle
 * mare" (the legacy visitemaurice.com article 301s into it, and it appears among the AI Overview's
 * sources). What it lacked was the one thing a visitor comparing the coast actually wants: what each
 * of those hotels is LIKE, and where on the beach it sits. A name in a pill is not information.
 *
 * The descriptions are operational — which end of the lagoon, how the approach road runs, what you
 * find when you walk out of the gate. That is what a driver-guide who collects from these gates
 * every week knows and an aggregator cannot copy, which is also what makes it worth publishing.
 *
 * NO HOTEL PHOTOGRAPHY IS REFERENCED HERE, deliberately. Resort press images belong to the hotels
 * and their photographers; promoting a property is not a licence to republish its photographs, and
 * this site has already had to swap one unlicensed hero. `image` stays optional and unset until a
 * genuinely free-licensed or permissioned file exists — Wikimedia Commons and Unsplash carry
 * commercially usable Mauritius photography, and a hotel's own press office will usually grant a
 * partner operator written permission. Fill it in then, not before.
 *
 * "We have a verbal OK from the hotels" does NOT settle this on its own, and it is worth writing
 * down why, because the question keeps coming back. A Google Images result for a resort is mostly
 * NOT the resort's own file: OTAs (Booking, Expedia) commission and license their own shoots,
 * travel bloggers and photographers hold their own copyright, and stock agencies watermark-free
 * comps circulate widely. The hotel can only grant what the hotel owns. So the permission has to
 * arrive WITH the files — a press-kit link, a Drive folder, an email naming the images — and then
 * they get dropped in as `/public/hotels/<slug>.webp` and named here. A hotel with no `image` set
 * renders as a typographic card, which is a designed state, not a gap.
 */

export interface DestinationHotel {
  /** Matches `airport_transfer_hotels.slug` where we run transfers, so a fare stays a join. */
  slug: string;
  name: string;
  /** Which stretch of coast — drives the grouping and the sub-heads on the page. */
  area: string;
  description: string;
  /** A licensed image under /public (convention: `/hotels/<slug>.webp`). See the header. */
  image?: string;
}

/**
 * Journey time to SSR for a hotel we do NOT run a transfer page for — the area figure from the
 * Belle Mare guide's own `gettingThere` copy, as a bare range (the page appends the localised
 * "min", so never put a unit here).
 *
 * There is deliberately NO per-hotel override in this file. `_transfers.gen.ts` already carries a
 * real `durationMinFromAirport` for thirteen of these fourteen properties, and it is what the
 * hotel's own /airport-transfers/<slug> page publishes. A second, hand-derived figure here means
 * the same site quotes two different journey times for one hotel — which is exactly what happened
 * on the first pass (Anahita Golf read ≈40 here and 50 on its transfer page). One source only.
 */
export const DEFAULT_AIRPORT_MINUTES = '45–60';

export interface HotelGroup {
  area: string;
  blurb: string;
  hotels: DestinationHotel[];
}

/* Belle Mare. Covers every name already listed in the area guide's `stayOptions`, plus the rest of
   the east-coast roster we quote fixed transfer fares to — so the page answers "which hotels are
   there" rather than "which seven did we happen to name". Ordered along the coast, south to north,
   then inland to the Anahita estate. */
const BELLE_MARE: HotelGroup[] = [
  {
    area: 'On Belle Mare beach',
    blurb:
      'The beach the page is named for — the widest, shallowest part of the lagoon and the shortest walk to the public sand.',
    hotels: [
      {
        slug: 'constance-belle-mare-plage',
        name: 'Constance Belle Mare Plage',
        area: 'On Belle Mare beach',
        description:
          'One of the largest properties on the beach, sitting behind a long frontage in the middle of the Belle Mare stretch, with two championship golf courses attached to the estate. Big enough that the gate matters — we confirm which reception before the day rather than guess.',
      },
      {
        slug: 'lux-belle-mare',
        name: 'LUX* Belle Mare',
        area: 'On Belle Mare beach',
        description:
          'Directly on the widest part of the lagoon, towards the northern end of the beach. Straightforward for pickups: one main entrance off the coast road, and the airport run takes about 50 minutes.',
      },
      {
        slug: 'long-beach-mauritius',
        name: 'Long Beach Mauritius',
        area: 'On Belle Mare beach',
        description:
          'A large, contemporary resort on its own bay at the southern end of the Belle Mare sand. The beach in front shelves gently and stays swimmable at low tide, which is not true of every stretch on this coast.',
      },
      {
        slug: 'the-residence-mauritius',
        name: 'The Residence Mauritius',
        area: 'On Belle Mare beach',
        description:
          'Colonial-styled and low-rise, on a quiet section of the beach under mature casuarina shade. Suits guests who want the lagoon without a resort the size of a village.',
      },
      {
        slug: 'solana-beach',
        name: 'Solana Beach Mauritius',
        area: 'On Belle Mare beach',
        description:
          'A smaller adults-only property on the Belle Mare frontage. Easy access straight off the coast road, and a short walk to the public beach if you want to leave the grounds for an afternoon.',
      },
      {
        slug: 'emeraude-beach-attitude',
        name: 'Émeraude Beach Attitude',
        area: 'On Belle Mare beach',
        description:
          'One of the more modestly priced places to stay directly on this coast, set just back from the sand. A sensible base if the plan is to be out on tours most days rather than in the resort.',
      },
      {
        slug: 'crystals-beach-resort',
        name: 'Crystals Beach Resort (Radisson Individuals)',
        area: 'On Belle Mare beach',
        description:
          'On the Palmar end of the Belle Mare beach, mid-range and family-oriented, with the lagoon straight ahead. Handy for the public beach and the Splash n Fun water park just up the coast road.',
      },
    ],
  },
  {
    area: 'Palmar & Trou d’Eau Douce',
    blurb:
      'Immediately south. Quieter water, and the closest you can stay to the Île aux Cerfs boat jetty.',
    hotels: [
      {
        slug: 'ambre-mauritius',
        name: 'Ambre Mauritius',
        area: 'Palmar & Trou d’Eau Douce',
        description:
          'Adults-only, on the Palmar stretch just south of Belle Mare where the beach narrows and the crowds thin out. Ten minutes closer to the Île aux Cerfs jetty than the Belle Mare hotels.',
      },
      {
        slug: 'shangri-la-le-touessrok',
        name: 'Shangri-La Le Touessrok',
        area: 'Palmar & Trou d’Eau Douce',
        description:
          'At Trou d’Eau Douce, on the water at the southern end of this coast, with its own boat access to Île aux Cerfs and the island’s golf course. The closest of the big resorts to the Île aux Cerfs departures.',
      },
      {
        slug: 'tropical-attitude',
        name: 'Tropical Attitude',
        area: 'Palmar & Trou d’Eau Douce',
        description:
          'A small adults-only hotel in Trou d’Eau Douce village itself, so you can walk to the boat jetty, the shops and a couple of genuinely local restaurants — rare on a coast of self-contained resorts.',
      },
    ],
  },
  {
    area: 'Poste de Flacq & the north-east',
    blurb:
      'North of Belle Mare, where the coast turns and the lagoon narrows. Add ten minutes to any drive.',
    hotels: [
      {
        slug: 'one-only-le-saint-geran',
        name: 'One&Only Le Saint Géran',
        area: 'Poste de Flacq & the north-east',
        description:
          'On its own peninsula at Poste de Flacq, north of Belle Mare, with lagoon on both sides. The access road runs a fair way in from the coast road, so allow an extra ten minutes on any departure.',
      },
      {
        slug: 'radisson-blu-azuri',
        name: 'Radisson Blu Azuri Resort & Spa',
        area: 'Poste de Flacq & the north-east',
        description:
          'At Roches Noires, on the north-eastern corner where the coast turns towards Grand Baie. Further from Belle Mare than the map suggests — closer to the north’s restaurants, further from the Île aux Cerfs boats.',
      },
    ],
  },
  {
    area: 'Beau Champ & the Anahita estate',
    blurb:
      'Inland of the coast road on the southern lagoon, around the golf estate — a different approach road from the beach hotels.',
    hotels: [
      {
        slug: 'four-seasons-anahita',
        name: 'Four Seasons Resort Mauritius at Anahita',
        area: 'Beau Champ & the Anahita estate',
        description:
          'On the southern lagoon at Beau Champ, spread across a large estate of private villas. Pickups happen at the villa rather than one reception, so we ask for the villa number the day before.',
      },
      {
        slug: 'anahita-golf-spa',
        name: 'Anahita Golf & Spa Resort',
        area: 'Beau Champ & the Anahita estate',
        description:
          'The golf side of the same Beau Champ estate, on the water facing Île aux Cerfs across the lagoon. Reached from the south, so the airport run is shorter than from Belle Mare — closer to 40 minutes.',
      },
    ],
  },
];

/** Rich hotel groups by destination slug. Absent slug → the page keeps its plain `stayOptions` pills. */
const BY_SLUG: Record<string, HotelGroup[]> = {
  'belle-mare': BELLE_MARE,
};

export function hotelGroupsFor(slug: string): HotelGroup[] | null {
  return BY_SLUG[slug] ?? null;
}

/** Flat list for JSON-LD and counts. */
export function hotelsFor(slug: string): DestinationHotel[] {
  return (BY_SLUG[slug] ?? []).flatMap((g) => g.hotels);
}
