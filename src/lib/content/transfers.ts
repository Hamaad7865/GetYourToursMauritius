import { TRANSFERS_RAW } from './_transfers.gen';
import { TRANSFERS_FR } from './_transfers.fr.gen';
import { localiseContent } from './localise';
import type { Locale } from '@/lib/i18n/config';
import { fitSnippet } from '@/lib/seo/snippet';

/**
 * Per-hotel airport-transfer landing pages. Raw content (intro/FAQ/etc.) is generated
 * into `_transfers.gen.ts`; this module types it and layers a representative "from" price
 * by region (SSR airport sits in the south-east, so the south/east coasts are nearest).
 */

export type TransferRegion = 'North' | 'South' | 'East' | 'West' | 'Central';

export interface TransferContent {
  slug: string;
  hotelName: string;
  area: string;
  region: TransferRegion;
  distanceKmFromAirport: number;
  durationMinFromAirport: number;
  /** Hotel coordinates (geocoded once into _transfers.gen.ts). Used to pin the hotel + draw the
   *  airport→hotel route on the maps. Optional: a missing coord falls back to geocoding by name. */
  lat?: number;
  lng?: number;
  intro: string;
  included: string[];
  nearbyAttractions: string[];
  faq: { q: string; a: string }[];
}

export interface Transfer extends TransferContent {
  path: string;
}

/**
 * The fields of a transfer guide that may be translated. An ALLOWLIST, deliberately: everything
 * omitted here — `slug`, `hotelName`, `area`, `region`, `distanceKmFromAirport`,
 * `durationMinFromAirport`, `lat`, `lng`, `nearbyAttractions` — is either a real hotel/place name or
 * a fact a customer relies on (a fare-relevant distance or drive time), never our own prose. `intro`
 * and `included` are our own marketing copy (they do name the hotel inline, e.g. "drop-off at LUX*
 * Belle Mare" — that's fine, the hotel name travels untouched inside the translated sentence). `faq`
 * is our own written Q&A, so it translates too — but the numbers inside it (km, minutes) must survive
 * unchanged, exactly like `intro`/`included`.
 */
export type TransferTranslation = Partial<Pick<TransferContent, 'intro' | 'included' | 'faq'>>;

/** A transfer guide in the visitor's language, falling back to English per field. */
export function localisedTransfer(t: Transfer, locale: Locale): Transfer {
  return localiseContent(t, TRANSFERS_FR[t.slug], locale);
}

/* A hotel's "from" price is NOT here. It used to be a hardcoded per-region constant, written when
 * airport fares were region-based; the fares later became ZONE-based and the constant never followed,
 * so every page advertised below what the widget charges (Belle Mare read "from €35" against a real
 * €55). It now comes from the live fare table via `transferFromPriceEur` in
 * `@/lib/transfers/from-price` — one source of truth, the one the owner edits in admin → Pricing. */

export function transferPath(slug: string): string {
  return `/airport-transfers/${slug}`;
}

export const transfers: Transfer[] = TRANSFERS_RAW.map((t) => ({
  ...t,
  path: transferPath(t.slug),
})).sort((a, b) => a.hotelName.localeCompare(b.hotelName));

export function getTransfer(slug: string): Transfer | null {
  return transfers.find((t) => t.slug === slug) ?? null;
}

/**
 * The listed hotel geographically CLOSEST to a picked point (e.g. a Google Places selection that isn't
 * one of our 45 hotels). Airport transfers are priced by a coarse zone (near-airport vs the rest), so the
 * nearest listed hotel shares the picked place's zone — we snap to it for pricing + its bookable page.
 * Squared-degree distance is fine over an island this small. Falls back to the first hotel if none carry
 * coordinates yet.
 */
export function nearestTransfer(lat: number, lng: number): Transfer {
  let best: Transfer = transfers[0]!;
  let bestDist = Infinity;
  // A degree of longitude at Mauritius's latitude (~20°S) is ~6% shorter than a degree of latitude,
  // so raw squared degrees overweight east–west separation. cos(lat) makes the comparison true
  // ground distance — it matters here because the Belle Mare resorts sit within a kilometre of each
  // other, close enough for a 6% skew to change which one is "nearest".
  const lngScale = Math.cos((lat * Math.PI) / 180);
  for (const t of transfers) {
    if (t.lat == null || t.lng == null) continue;
    const dist = (t.lat - lat) ** 2 + ((t.lng - lng) * lngScale) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

/**
 * The FAQ entries that DON'T name this listed hotel or its area — the safe subset to show on a
 * snapped-hotel (?hotel=) override view. There the page's H1, map and booking all read as the GUEST's
 * own hotel (see src/lib/content/guest-hotel.ts), so a Q&A that names THIS hotel ("…transfer to Pearle
 * Beach Resort & Spa in Flic-en-Flac…") would flatly contradict it. Metadata/JSON-LD keep the full
 * canonical FAQ — only the visible list is trimmed, and only under an override.
 */
export function genericTransferFaq(t: Transfer): TransferContent['faq'] {
  const needles = [t.hotelName.toLowerCase(), t.area.toLowerCase()];
  return t.faq.filter((f) => {
    const hay = `${f.q} ${f.a}`.toLowerCase();
    return !needles.some((n) => hay.includes(n));
  });
}

export const TRANSFER_REGION_ORDER: TransferRegion[] = [
  'North',
  'East',
  'South',
  'West',
  'Central',
];

/* Both take the from-price as an argument rather than reading it off the hotel: it comes from the
 * live fare table now (see the note above), and a stale number in a <title> is the one place a wrong
 * price is hardest to notice — it goes straight into Google's snippet. */

/**
 * Resort names as guests say them, for the <title> only. With the full name ("Four Seasons Resort
 * Mauritius at Anahita") the title ran to 90 characters and Google cut the price and the brand off
 * every one of these pages. The page body, H1 and JSON-LD keep the full name.
 */
const SHORT_HOTEL_NAMES: Record<string, string> = {
  'Four Seasons Resort Mauritius at Anahita': 'Four Seasons Anahita',
  'Anahita Golf & Spa Resort': 'Anahita',
  'Royal Palm Beachcomber Luxury': 'Royal Palm Beachcomber',
  'The St. Regis Mauritius Resort': 'St. Regis Mauritius',
  'The Westin Turtle Bay Resort & Spa': 'Westin Turtle Bay',
  'Radisson Blu Azuri Resort & Spa': 'Radisson Blu Azuri',
  'Mauricia Beachcomber Resort & Spa': 'Mauricia Beachcomber',
  'Shandrani Beachcomber Resort & Spa': 'Shandrani Beachcomber',
  'Outrigger Mauritius Beach Resort': 'Outrigger Mauritius',
  'Hilton Mauritius Resort & Spa': 'Hilton Mauritius',
  'Maradiva Villas Resort & Spa': 'Maradiva',
  'Sands Suites Resort & Spa': 'Sands Suites',
  'Pearle Beach Resort & Spa': 'Pearle Beach',
  'Constance Belle Mare Plage': 'Belle Mare Plage',
};

export function shortHotelName(hotelName: string): string {
  return SHORT_HOTEL_NAMES[hotelName] ?? hotelName;
}

export function transferMetaTitle(t: Transfer, fromPriceEur: number): string {
  // Root template appends the site name — don't repeat the brand here. The price comes before the
  // brand, so a long name pushes the brand out of Google's snippet, never the price.
  return `${shortHotelName(t.hotelName)} Airport Transfer from €${fromPriceEur}`;
}

/**
 * The French search snippet for a hotel transfer. /fr/airport-transfers/<hotel> used to show the
 * English sentence above, identical to the English page — 45 duplicate titles in the site audit.
 * Absolute title, like every French snippet, so it names the brand itself where it fits.
 */
export function transferMetaFr(
  t: Transfer,
  fromPriceEur: number,
): { title: string; description: string } {
  return {
    title: `Transfert aéroport vers ${t.hotelName} : dès ${fromPriceEur} €`,
    description: fitSnippet(
      `Transfert privé de l’aéroport SSR à ${t.hotelName}, ${t.area} (environ ${t.durationMinFromAirport} min). Prix fixe dès ${fromPriceEur} € par voiture, accueil à l’arrivée et suivi du vol.`,
    ),
  };
}

export function transferMetaDescription(t: Transfer, fromPriceEur: number): string {
  // Price first: the long version ran 200–230 characters and Google cut it before the fare.
  return fitSnippet(
    `Private SSR Airport transfer to ${t.hotelName}, ${t.area}: from €${fromPriceEur} per car, about ${t.durationMinFromAirport} min. Meet & greet, flight tracking, free child seat.`,
  );
}
