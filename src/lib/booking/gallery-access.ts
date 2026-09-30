/**
 * Who may see a booking's gallery photos — the TypeScript twin of the `booking_photos_select` RLS
 * policy (20261013000000_gallery_ready_flow). The two MUST agree: the policy protects a direct table
 * read, this rule shapes the `GET /bookings/:ref/gallery` response (which reads through the service
 * role and so bypasses RLS entirely).
 *
 * The photo files live in the PUBLIC activity-images bucket, so a URL is a bearer credential: once
 * it has been handed to the browser the "lock" is gone. That is why a locked gallery returns NO
 * photos — hiding them in the UI alone let an unpaid guest read every URL out of the response.
 *
 *   hidden  the studio has not confirmed the gallery complete (`gallery_ready_at`), or the booking is
 *           not live. The guest sees nothing — not even that photos exist.
 *   locked  delivered, but the balance is still owed. The guest sees the "pay the balance" teaser
 *           (counts only, never a URL).
 *   open    delivered and paid in full. The photos are served.
 */
import { isVideoUrl } from '@/lib/media';

export type GalleryAccess = 'hidden' | 'locked' | 'open';

/** Booking statuses whose gallery may be served — the same set the RLS policy admits. */
const LIVE_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'completed']);

export function galleryAccess(input: {
  /** bookings.gallery_ready_at — set when the studio confirms delivery. */
  readyAt: string | null | undefined;
  /** bookings.balance_due_minor — the stored projection append_payment_event maintains. */
  balanceDueMinor: number;
  status: string;
}): GalleryAccess {
  if (!input.readyAt) return 'hidden';
  if (!LIVE_STATUSES.has(input.status)) return 'hidden';
  return input.balanceDueMinor > 0 ? 'locked' : 'open';
}

export interface GalleryPhotoRow {
  id: string;
  url: string;
  position: number;
}

export interface GalleryResponse {
  photos: GalleryPhotoRow[];
  locked: boolean;
  balanceDueMinor: number;
  meta: {
    packageTitle: string | null;
    shootDate: string | null;
    location: string | null;
    photoCount: number;
    videoCount: number;
  };
}

/**
 * The response body for one booking's gallery, shaped by {@link galleryAccess}. `photos` is only ever
 * populated when access is `open`; `meta.photoCount` stays truthful for `locked` so the page can
 * still draw the teaser, and is zero for `hidden` so an undelivered gallery leaks nothing.
 */
export function buildGalleryResponse(input: {
  access: GalleryAccess;
  photos: readonly GalleryPhotoRow[];
  balanceDueMinor: number;
  packageTitle: string | null;
  shootDate: string | null;
  location: string | null;
}): GalleryResponse {
  const { access, photos } = input;
  if (access === 'hidden') {
    return {
      photos: [],
      locked: false,
      balanceDueMinor: input.balanceDueMinor,
      meta: { packageTitle: null, shootDate: null, location: null, photoCount: 0, videoCount: 0 },
    };
  }
  return {
    photos: access === 'open' ? [...photos] : [],
    locked: access === 'locked',
    balanceDueMinor: input.balanceDueMinor,
    meta: {
      packageTitle: input.packageTitle,
      shootDate: input.shootDate,
      location: input.location,
      photoCount: photos.length,
      videoCount: photos.filter((p) => isVideoUrl(p.url)).length,
    },
  };
}
