/**
 * Photography & film — the rules shared by the public pages, the booking widget and /admin.
 *
 * A photography package is an ordinary catalogue activity whose category is exactly
 * PHOTOGRAPHY_CATEGORY. That is the whole integration: dates come from its availability, "extra
 * guests" from a private option (base covers N, a price per extra head), add-ons (drone, extra hour,
 * album…) from its supplements, and payment from the one checkout — nothing about the money path is
 * re-implemented for photography.
 *
 * Pure (no framework imports), so it is safe on the server, the client and in tests.
 */

export const PHOTOGRAPHY_CATEGORY = 'Photography';

/** The `activities.extra` key a TOUR uses to list the photography package slugs it offers as an
 *  add-on (set in the tour editor's Logistics pane). */
export const PHOTOGRAPHY_ADD_ONS_KEY = 'photographyAddOns';

export function isPhotographyCategory(category: string | null | undefined): boolean {
  return (category ?? '').trim().toLowerCase() === PHOTOGRAPHY_CATEGORY.toLowerCase();
}

export type PhotographyGroup = 'weddings' | 'shoots';

/** Weddings and wedding films vs every other shoot, read from the owner's own title/summary so no
 *  extra field is needed. */
export function photographyGroup(p: { title: string; summary?: string | null }): PhotographyGroup {
  return /wedding|elop|film|mariage|vow/i.test(`${p.title} ${p.summary ?? ''}`)
    ? 'weddings'
    : 'shoots';
}

/** Normalise whatever `extra.photographyAddOns` holds into a clean, de-duplicated slug list. */
export function photographyAddOnSlugs(extra: unknown): string[] {
  const raw =
    extra && typeof extra === 'object'
      ? (extra as Record<string, unknown>)[PHOTOGRAPHY_ADD_ONS_KEY]
      : undefined;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** One cross-sell card on a booking card: a photography package on a tour, or a private tour on a
 *  photography package. Display only — the linked page prices and books it itself. */
export interface CrossSellItem {
  slug: string;
  title: string;
  fromPriceEur: number | null;
  image: string | null;
}

/** Deep link that opens `slug`'s booking card on the same day for the same party, so pairing a shoot
 *  with a tour (or the reverse) is two clicks, not a second search. */
export function crossSellHref(slug: string, date: string, guests: number): string {
  const params = new URLSearchParams();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.set('date', date);
  if (guests > 0) params.set('adults', String(Math.round(guests)));
  const qs = params.toString();
  return `/activities/${encodeURIComponent(slug)}${qs ? `?${qs}` : ''}`;
}

/** The add-on menu the admin "New package" template pre-fills. Prices are suggestions the owner
 *  edits before saving — they are written into activity_supplements, which is what api_book reads. */
export const PHOTOGRAPHY_ADD_ON_PRESETS: { name: string; nameFr: string; priceEur: number }[] = [
  { name: 'Drone aerials', nameFr: 'Vues aériennes par drone', priceEur: 120 },
  { name: 'Extra hour of coverage', nameFr: 'Heure de couverture supplémentaire', priceEur: 90 },
  { name: 'Same-day preview photos', nameFr: 'Aperçu photo le jour même', priceEur: 40 },
  { name: 'Printed album', nameFr: 'Album imprimé', priceEur: 180 },
];
