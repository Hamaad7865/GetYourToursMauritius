/**
 * Matching the names ZilAi emphasises in its replies back to places we actually know about, so the
 * chat can show a preview of **Blue Bay Beach** on hover.
 *
 * The model writes names for a human, not for a lookup: "Ile Aux Cerfs" for `Île aux Cerfs`, a name
 * with a trailing article, a tour title shortened by a word. So matching is done on a normalised key
 * (accents folded, punctuation dropped, case and spacing collapsed) with a containment fallback —
 * generous enough to catch the model's phrasing, strict enough that a two-word beach name doesn't
 * match half the island. Pure and unit-tested; the DOM work lives in the component.
 */

/** A preview of somewhere named in the chat — a Google place from the day, or one of our own tours. */
export interface PlacePreview {
  name: string;
  category: string | null;
  region: string | null;
  blurb: string | null;
  /** Short factual chips ("about 1h here", "closes 17:00"). Google supplies an editorial summary for
   *  only a minority of places, so without these most previews would be a name and nothing else. */
  facts: string[];
  /** Photo URLs, already proxied. Empty when we have none — the card then shows just the words. */
  images: string[];
  /** Set for our OWN bookable tours: the activity page, its "from" price and rating. */
  href: string | null;
  priceLabel: string | null;
  ratingLabel: string | null;
}

/** Fold a name to its comparison key: accents stripped, punctuation dropped, spacing collapsed. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD') // é → e + U+0301, so the combining marks can be stripped as a range
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Index previews by normalised name. Later entries lose to earlier ones, so callers put the more
 *  specific source (our own tours) first. */
export function buildPreviewIndex(previews: PlacePreview[]): Map<string, PlacePreview> {
  const index = new Map<string, PlacePreview>();
  for (const preview of previews) {
    const key = normalizeName(preview.name);
    if (key && !index.has(key)) index.set(key, preview);
  }
  return index;
}

/** The shortest name we'll match loosely. Below this, containment matches far too much ("Bay",
 *  "Le Morne" inside "Le Morne Brabant Beach Hotel") and the card would show the wrong place. */
const MIN_LOOSE_KEY = 8;

/** Find the preview for a name ZilAi wrote, or null. Exact normalised match wins; otherwise the one
 *  entry whose key contains (or is contained by) the query — ambiguity resolves to no card, because
 *  showing the wrong place is worse than showing none. */
export function findPreview(index: Map<string, PlacePreview>, name: string): PlacePreview | null {
  const key = normalizeName(name);
  if (!key) return null;
  const exact = index.get(key);
  if (exact) return exact;
  if (key.length < MIN_LOOSE_KEY) return null;
  let found: PlacePreview | null = null;
  for (const [candidate, preview] of index) {
    if (candidate.length < MIN_LOOSE_KEY) continue;
    if (!candidate.includes(key) && !key.includes(candidate)) continue;
    if (found) return null; // two plausible places — don't guess
    found = preview;
  }
  return found;
}
