/**
 * Pure view-model helpers for the booking photo gallery (src/components/booking/BookingGallery).
 * Everything here is side-effect free except the localStorage favourites read/write, which is
 * guarded so it also runs in tests and SSR snapshots.
 */
import { isVideoUrl } from '@/lib/media';

export interface GalleryPhoto {
  id: string;
  url: string;
  position: number;
}

/** The translate function handed to presentational gallery components (useT's shape). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export interface GalleryMeta {
  packageTitle: string | null;
  shootDate: string | null;
  location: string | null;
  photoCount: number;
  videoCount: number;
}

/** What `GET /api/v1/bookings/:ref/gallery` hands the booking page (the envelope's `data`). */
export interface GalleryPayload {
  photos: GalleryPhoto[];
  locked?: boolean;
  balanceDueMinor?: number;
  meta?: Partial<GalleryMeta> | null;
}

/**
 * Unwrap the API's `{ ok, data }` envelope into the payload the gallery renders — `null` for anything
 * that is not a success envelope. Every /api/v1 route answers in that envelope (`jsonOk`), so reading
 * `.photos` off the raw body silently yields nothing: the gallery would never render, paid or not.
 * Photos without a usable URL are dropped rather than rendered as broken tiles.
 */
export function parseGalleryResponse(body: unknown): GalleryPayload | null {
  if (!body || typeof body !== 'object') return null;
  const { ok, data } = body as { ok?: unknown; data?: unknown };
  if (ok !== true || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const photos = (Array.isArray(d.photos) ? d.photos : [])
    .filter(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === 'object' && typeof (p as { url?: unknown }).url === 'string',
    )
    .filter((p) => (p.url as string).length > 0)
    .map((p) => ({
      id: String(p.id ?? ''),
      url: p.url as string,
      position: Number(p.position ?? 0),
    }));
  return {
    photos,
    locked: d.locked === true,
    balanceDueMinor: typeof d.balanceDueMinor === 'number' ? d.balanceDueMinor : undefined,
    meta: d.meta && typeof d.meta === 'object' ? (d.meta as Partial<GalleryMeta>) : null,
  };
}

export type GalleryTab = 'all' | 'photos' | 'videos' | 'favs';

export const GALLERY_TABS: readonly GalleryTab[] = ['all', 'photos', 'videos', 'favs'];

export function galleryFavKey(bookingRef: string): string {
  return `gytm:galleryfavs:${bookingRef}`;
}

/** Stored favourite ids for this booking — an empty array before mount / when storage is empty. */
export function readGalleryFavourites(bookingRef: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(galleryFavKey(bookingRef));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function writeGalleryFavourites(bookingRef: string, ids: Iterable<string>): void {
  try {
    globalThis.localStorage?.setItem(galleryFavKey(bookingRef), JSON.stringify([...ids]));
  } catch {
    /* private mode / full storage — favourites just don't persist */
  }
}

/** Copy-on-write toggle — the React state stays immutable. */
export function toggleFavourite(favs: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(favs);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function filterGalleryByTab(
  photos: readonly GalleryPhoto[],
  tab: GalleryTab,
  favs: ReadonlySet<string>,
): GalleryPhoto[] {
  if (tab === 'all') return [...photos];
  if (tab === 'favs') return photos.filter((p) => favs.has(p.id));
  const wantVideo = tab === 'videos';
  return photos.filter((p) => isVideoUrl(p.url) === wantVideo);
}

export function galleryTabCounts(
  photos: readonly GalleryPhoto[],
  favs: ReadonlySet<string>,
): Record<GalleryTab, number> {
  let videos = 0;
  for (const p of photos) if (isVideoUrl(p.url)) videos += 1;
  return {
    all: photos.length,
    photos: photos.length - videos,
    videos,
    favs: photos.filter((p) => favs.has(p.id)).length,
  };
}

/** `BMT-4821` → `bmt-4821` — lowercase, url-safe base for zip names. */
export function gallerySlug(bookingRef: string): string {
  return (
    bookingRef
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'gallery'
  );
}

/** Extension of the media a URL points at, without the dot (`jpg`, `mp4`) — `jpg` fallback. */
export function mediaExt(url: string): string {
  try {
    const path = new URL(url, 'https://placeholder.invalid').pathname;
    const ext = path.split('.').pop()?.toLowerCase();
    return ext && /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'jpg';
  } catch {
    return 'jpg';
  }
}

/** Last path segment of a media URL, decoded — the filename the lightbox shows in its counter row. */
export function mediaBaseName(url: string): string {
  try {
    return decodeURIComponent(
      new URL(url, 'https://placeholder.invalid').pathname.split('/').pop() ?? '',
    );
  } catch {
    return url.split('/').pop() ?? url;
  }
}

export type ZipQuality = 'originals' | 'web';

export interface ZipEntrySpec {
  /** Archive path — zero-padded so unzipped files keep the gallery order. */
  name: string;
  url: string;
  video: boolean;
}

/**
 * The ZIP manifest for a download: photos as `{slug}-001.jpg`, videos as `{slug}-video-01.mp4`,
 * numbered separately so each kind keeps its own sequence. Web quality recompresses photos, so
 * those entries always carry a `.jpg` name regardless of the source format. Pure — unit-tested.
 */
export function buildZipEntries(
  photos: readonly GalleryPhoto[],
  opts: {
    includePhotos: boolean;
    includeVideos: boolean;
    quality: ZipQuality;
    slug: string;
  },
): ZipEntrySpec[] {
  const entries: ZipEntrySpec[] = [];
  let photoN = 0;
  let videoN = 0;
  for (const p of photos) {
    const video = isVideoUrl(p.url);
    if (video) {
      if (!opts.includeVideos) continue;
      videoN += 1;
      entries.push({
        name: `${opts.slug}-video-${String(videoN).padStart(2, '0')}.${mediaExt(p.url)}`,
        url: p.url,
        video: true,
      });
    } else {
      if (!opts.includePhotos) continue;
      photoN += 1;
      const ext = opts.quality === 'web' ? 'jpg' : mediaExt(p.url);
      entries.push({
        name: `${opts.slug}-${String(photoN).padStart(3, '0')}.${ext}`,
        url: p.url,
        video: false,
      });
    }
  }
  return entries;
}

/** `65.4` → `1:05` — the lightbox / video-chip clock. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Default row height (px) per thumbnail-size step — the ± control in the toolbar. */
export const THUMB_ROW_HEIGHTS = [130, 190, 270, 380] as const;
