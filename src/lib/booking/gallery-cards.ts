/**
 * One row of the account "Galleries" page: a customer's delivered (or delivered-but-locked)
 * photography gallery. Pure shaping so it's unit-testable; the route reads the rows and shapes
 * them here. Access reuses `galleryAccess` — the same rule the gallery API and RLS policy apply.
 */
import { galleryAccess } from './gallery-access';
import { isVideoUrl } from '@/lib/media';

export interface GalleryCardInput {
  ref: string;
  packageTitle: string;
  shootDate: string | null;
  /** Every photo/video URL the booking has (server-side read — never reaches locked clients). */
  photoUrls: readonly string[];
  /** The package's public catalogue cover — used for locked galleries so no photo URL leaks. */
  packageCover: string | null;
  readyAt: string | null;
  balanceDueMinor: number;
  status: string;
}

export interface GalleryCard {
  ref: string;
  packageTitle: string;
  shootDate: string | null;
  photoCount: number;
  videoCount: number;
  access: 'locked' | 'open';
  /** Open galleries show their first photo; locked ones show the package's public cover. */
  coverUrl: string | null;
  balanceDueMinor: number;
}

/** null when the gallery is hidden (not delivered, or booking not live) — those never list. */
export function buildGalleryCard(input: GalleryCardInput): GalleryCard | null {
  const access = galleryAccess({
    readyAt: input.readyAt,
    balanceDueMinor: input.balanceDueMinor,
    status: input.status,
  });
  if (access === 'hidden') return null;
  // An <img> cannot draw a video, so an open gallery that happens to start with one still wants a
  // PHOTO for its cover; with nothing but videos it falls back to the package cover like a locked one.
  const firstPhoto = input.photoUrls.find((u) => !isVideoUrl(u)) ?? null;
  return {
    ref: input.ref,
    packageTitle: input.packageTitle,
    shootDate: input.shootDate,
    photoCount: input.photoUrls.filter((u) => !isVideoUrl(u)).length,
    videoCount: input.photoUrls.filter((u) => isVideoUrl(u)).length,
    access,
    coverUrl: access === 'open' ? (firstPhoto ?? input.packageCover) : input.packageCover,
    balanceDueMinor: input.balanceDueMinor,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isGalleryCard(v: unknown): v is GalleryCard {
  return (
    isRecord(v) &&
    typeof v.ref === 'string' &&
    typeof v.packageTitle === 'string' &&
    (v.shootDate === null || typeof v.shootDate === 'string') &&
    typeof v.photoCount === 'number' &&
    typeof v.videoCount === 'number' &&
    (v.access === 'locked' || v.access === 'open') &&
    (v.coverUrl === null || typeof v.coverUrl === 'string') &&
    typeof v.balanceDueMinor === 'number'
  );
}

/**
 * The browser's reading of `GET /api/v1/account/galleries`. Every /api/v1 route answers
 * `{ ok: true, data }`, so the list lives at `data.galleries` — reading it off the raw body is how the
 * booking gallery once shipped never rendering. Returns null when the body is not that envelope (the
 * caller shows "couldn't load"), `[]` for a customer with no galleries, and skips any card that does
 * not have the expected shape rather than failing the whole list.
 */
export function parseAccountGalleriesResponse(json: unknown): GalleryCard[] | null {
  if (!isRecord(json) || json.ok !== true || !isRecord(json.data)) return null;
  const list = json.data.galleries;
  if (!Array.isArray(list)) return null;
  return list.filter(isGalleryCard);
}
