/**
 * What the account nav and the Galleries page show while the list loads, refreshes and fails.
 * Pure, so the rules are unit-tested; `useAccountGalleries` is thin glue around them.
 */
import type { GalleryCard } from './gallery-cards';

export type AccountGalleriesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; cards: GalleryCard[] };

/** One answer, remembered with the key of the customer + attempt it was fetched for. */
export interface SettledGalleries {
  key: string;
  /** null = the fetch failed. */
  cards: GalleryCard[] | null;
}

/**
 * The key an answer belongs to: the customer and the retry count — deliberately NOT the access token.
 * Supabase swaps the token roughly hourly; keyed on it, every refresh read as a different request and
 * the Galleries tab vanished (and the page fell back to skeletons) until the refetch landed.
 */
export function galleriesKey(userId: string | null, attempt: number): string | null {
  return userId ? `${attempt}:${userId}` : null;
}

/**
 * The state to render for `key`: loading until an answer for THIS customer and attempt exists, so
 * another customer's answer (sign-out → sign-in) or a previous attempt's never shows.
 */
export function galleriesState(
  settled: SettledGalleries | null,
  key: string | null,
): AccountGalleriesState {
  if (!key || !settled || settled.key !== key) return { status: 'loading' };
  return settled.cards ? { status: 'ready', cards: settled.cards } : { status: 'error' };
}

/**
 * What to remember when a fetch for `key` finishes. A background refresh of the SAME key that fails
 * keeps the last good answer (one blip must not blank the tab); a first load, or a retry, that fails
 * is an error.
 */
export function settleGalleries(
  prev: SettledGalleries | null,
  key: string,
  cards: GalleryCard[] | null,
): SettledGalleries {
  if (cards === null && prev && prev.key === key && prev.cards) return prev;
  return { key, cards };
}
