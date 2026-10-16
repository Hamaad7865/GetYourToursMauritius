import type { Locale } from '@/lib/i18n/config';
import type { TourDetail } from '@/lib/validation/tours';
import { SITE } from './site';
import { fitSnippet, SNIPPET_MAX } from './snippet';

/**
 * Search-result title and description for a tour page.
 *
 * 41 of 44 live tours had no search title, so Google showed the bare booking name ("Full Day 5
 * Islands tour Ile Aux Cerfs  with Lunch") and the card summary, with no price and often not the
 * phrase people type ("5 island tour mauritius", "sunset cruise mauritius", "undersea walk
 * mauritius"). Order of precedence:
 *   1. a search title/description set in /admin (the owner's choice always wins);
 *   2. a hand-written title below, for tours with real search demand (Search Console, 15 Sep–13 Oct
 *      2026) and a weak click rate;
 *   3. the tour's own name, cleaned up, with "Mauritius" added when it fits.
 * Titles lead with the searched phrase and keep the part before the brand to ~45 characters, so the
 * phrase is never what gets truncated.
 *
 * Deliberately NOT hand-titled, because their current title already wins clicks: the seaplane (its
 * "underwater waterfall" wording ranks on page one), the French 5-islands and northern-islands pages.
 */
const TOUR_TITLES: Record<string, Partial<Record<Locale, string>>> = {
  // "5 island tour mauritius" — 336 impressions at #6.5, 2% CTR. French twin already 4.6%: left as is.
  'the-blue-cruise-ile-aux-cerfs-5-islands-visit': {
    en: '5 Island Tour Mauritius with Île aux Cerfs',
  },
  // "undersea walk mauritius", "underwater sea walk mauritius" — 1,138 impressions, 0.5% CTR. The walk
  // starts at Belle Mare.
  'underwater-sea-walk-excursion': {
    en: 'Undersea Walk Mauritius: Sea Walk at Belle Mare',
    fr: 'Marche sous-marine à l’île Maurice (Belle Mare)',
  },
  // "sunset cruise mauritius", "sunset catamaran mauritius" — 0 clicks from ~250 impressions.
  'catamaran-sunset-cruise': {
    en: 'Sunset Cruise Mauritius: Catamaran in Grand Baie',
    fr: 'Croisière coucher de soleil, île Maurice',
  },
  'catamaran-cruise-ile-aux-cerfs': {
    en: 'Île aux Cerfs Catamaran Cruise, Mauritius',
    fr: 'Catamaran île aux Cerfs, île Maurice',
  },
  // "blue safari mauritius", "blue safari submarine", "mauritius submarine" — 0 clicks.
  'blue-safari-submarine-subscooter': {
    en: 'Blue Safari Submarine Mauritius & Subscooter',
    fr: 'Sous-marin Blue Safari, île Maurice',
  },
  // "skydiving mauritius", "skydive mauritius" — 997 impressions, 0.6% CTR.
  skydive: {
    en: 'Skydiving in Mauritius: 10,000 ft Tandem Jump',
    fr: 'Saut en parachute à l’île Maurice (tandem)',
  },
  // "parc casela ile maurice" — 113 impressions at #7.1, no clicks.
  'casela-world-of-adventures': {
    fr: 'Parc Casela, île Maurice : World of Adventures',
  },
  // "helicoptere ile maurice" — the French page's main search.
  helicotour: {
    fr: 'Tour en hélicoptère, île Maurice',
  },
};

/** Longest generic title we still add "Mauritius" to, so the brand stays in the visible title. */
const PLACE_SUFFIX_MAX = 45;

type MetaTour = Pick<
  TourDetail,
  | 'slug'
  | 'title'
  | 'summary'
  | 'description'
  | 'seoTitle'
  | 'seoDescription'
  | 'fromPriceEur'
  | 'fromPriceMaxGuests'
  | 'pricingMode'
  | 'pickupAvailable'
  | 'isAirportTransfer'
>;

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function activityMetaTitle(
  tour: Pick<MetaTour, 'slug' | 'title' | 'seoTitle'>,
  locale: Locale = 'en',
): string {
  if (tour.seoTitle?.trim()) return tour.seoTitle.trim();
  const curated = TOUR_TITLES[tour.slug]?.[locale];
  if (curated) return `${curated} | ${SITE.operator}`;
  const name = clean(tour.title);
  const place = locale === 'fr' ? 'île Maurice' : 'Mauritius';
  const named =
    /maurice|mauritius/i.test(name) || name.length + place.length + 2 > PLACE_SUFFIX_MAX
      ? name
      : `${name}, ${place}`;
  return `${named} | ${SITE.operator}`;
}

function euros(n: number, locale: Locale): string {
  const amount = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return locale === 'fr' ? `${amount.replace('.', ',')} €` : `€${amount}`;
}

/**
 * The booking line after the summary: the same from-price and unit the tour card shows, and pickup
 * when the tour offers it. A price is only quoted where its unit is unambiguous; no policy claims
 * (cancellation cut-offs differ between tours).
 */
export function activityPriceLine(tour: MetaTour, locale: Locale = 'en'): string {
  const fr = locale === 'fr';
  const parts: string[] = [];
  const price = tour.fromPriceEur;
  if (price != null && price > 0 && !tour.isAirportTransfer) {
    const from = fr ? `À partir de ${euros(price, locale)}` : `From ${euros(price, locale)}`;
    if (tour.pricingMode === 'per_person')
      parts.push(`${from} ${fr ? 'par personne' : 'per person'}.`);
    else if (tour.pricingMode === 'vehicle')
      parts.push(`${from} ${fr ? 'par véhicule' : 'per vehicle'}.`);
    else if (tour.pricingMode === 'per_group' && tour.fromPriceMaxGuests)
      parts.push(
        fr
          ? `${from} par groupe jusqu’à ${tour.fromPriceMaxGuests} personnes.`
          : `${from} per group of up to ${tour.fromPriceMaxGuests}.`,
      );
  }
  if (tour.pickupAvailable)
    parts.push(fr ? 'Prise en charge à l’hôtel possible.' : 'Hotel pickup available.');
  return parts.join(' ');
}

/**
 * The booking line goes FIRST: most tour summaries are one long sentence, and putting the price after
 * it meant the price was the part dropped to fit the snippet. The summary then fills what is left.
 */
export function activityMetaDescription(tour: MetaTour, locale: Locale = 'en'): string {
  if (tour.seoDescription?.trim()) return tour.seoDescription.trim();
  const lead = clean(tour.summary ?? tour.description ?? SITE.description);
  const line = activityPriceLine(tour, locale);
  if (!line) return fitSnippet(lead);
  return `${line} ${fitSnippet(lead, SNIPPET_MAX - line.length - 1)}`;
}
