import { ProviderError } from '@/lib/services/errors';

/**
 * Fetches the business's own Google reviews via Places API (New) Place Details. Deliberately
 * UNCACHED — unlike the rest of src/lib/maps/google-places.ts, Google Maps Platform's Places API
 * caching policy excludes review text/author data from the cacheable fields, so this must be
 * fetched live on every call, never persisted. Capped at 5 reviews (Google's own relevance pick;
 * there is no sort/pagination control on this field). See the design spec §2f for why the fuller
 * Business Profile API sync is deferred until the profile is 60+ days verified.
 */

const DETAILS_BASE = 'https://places.googleapis.com/v1/places/';
const REVIEW_FIELDS = 'id,displayName,rating,userRatingCount,reviews';

export interface OwnGoogleReview {
  authorName: string;
  authorPhotoUrl: string | null;
  rating: number;
  text: string | null;
  relativeTime: string | null;
  googleMapsUri: string | null;
}

export interface OwnGoogleReviewsResult {
  rating: number | null;
  userRatingCount: number | null;
  reviews: OwnGoogleReview[];
}

interface RawReview {
  rating?: number;
  text?: { text?: string };
  relativePublishTimeDescription?: string;
  authorAttribution?: { displayName?: string; photoUri?: string; uri?: string };
  googleMapsUri?: string;
}

interface RawPlaceDetails {
  rating?: number;
  userRatingCount?: number;
  reviews?: RawReview[];
}

/** Live fetch — no cache layer. Throws ProviderError on a non-2xx response. */
export async function fetchOwnGoogleReviews(
  placeId: string,
  apiKey: string,
): Promise<OwnGoogleReviewsResult> {
  const res = await fetch(`${DETAILS_BASE}${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': REVIEW_FIELDS },
  });
  if (!res.ok) throw new ProviderError(`Places Details HTTP ${res.status}`);
  const data = (await res.json()) as RawPlaceDetails;
  return {
    rating: data.rating ?? null,
    userRatingCount: data.userRatingCount ?? null,
    reviews: (data.reviews ?? []).map((r) => ({
      authorName: r.authorAttribution?.displayName ?? 'Google user',
      authorPhotoUrl: r.authorAttribution?.photoUri ?? null,
      rating: r.rating ?? 0,
      text: r.text?.text ?? null,
      relativeTime: r.relativePublishTimeDescription ?? null,
      googleMapsUri: r.googleMapsUri ?? null,
    })),
  };
}
