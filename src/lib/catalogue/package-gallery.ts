/**
 * The photoshoot package page's gallery: a lead photo plus four tiles, then "View all N" for the rest —
 * photos AND videos (an uploaded file, or a YouTube / Vimeo link), edited in the Photography package form.
 *
 * One rule is load-bearing: `images[0]` must always be a real photo. Cards, search and the social-share
 * image all read it (`heroImage` is the image with the lowest position), so a video or a link there would
 * be a broken picture everywhere. The rule is not specific to packages: both editors enforce it on save
 * (`imageRows` puts a photo in front, `validateLeadPhoto` stops a list with no photo at all), and the
 * package page re-asserts it on read.
 *
 * Pure — safe on the server, the client and in tests.
 */
import { mediaKind } from '@/lib/media';
import type { TourImage } from '@/lib/validation/tours';

/** Tiles in the grid: the lead plus four. Everything past that opens under "View all". */
export const PACKAGE_GRID_TILES = 5;

/**
 * `items` with a photo first. If a video or link would lead, the first PHOTO moves to the front and the
 * rest keep their order. It cannot invent a photo: a list of only videos comes back as it was.
 */
export function ensureImageLead<T extends { url: string }>(items: readonly T[]): T[] {
  const first = items[0];
  if (!first || mediaKind(first.url) === 'image') return [...items];
  const at = items.findIndex((i) => mediaKind(i.url) === 'image');
  if (at < 0) return [...items];
  return [items[at]!, ...items.slice(0, at), ...items.slice(at + 1)];
}

/**
 * What the package page shows, in order: the cover first (the owner-picked one, built here if it is not
 * among the saved photos), then everything else as the owner arranged it. Empty rows and repeats of a URL
 * are dropped, and with no cover the first real photo leads.
 */
export function packageGalleryImages(
  images: readonly TourImage[],
  cover: string | null,
  title: string,
): TourImage[] {
  const seen = new Set<string>();
  const real = images.filter((i) => {
    const url = i.url.trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  const coverUrl = cover?.trim() || null;
  if (!coverUrl) return ensureImageLead(real);
  const lead = real.find((i) => i.url === coverUrl) ?? {
    id: 'cover',
    url: coverUrl,
    alt: title,
    position: 0,
  };
  return [lead, ...real.filter((i) => i.url !== coverUrl)];
}

/**
 * Grid-cell classes for the tiles beside the lead, which sit in a 2×2 block. The block is always filled
 * exactly — one tile spans all four cells, two stack, three put one on top and two below, four make the
 * 2×2 — so no count of photos leaves a hole. More than four are clamped (the rest open under "View all").
 */
export function sideTileClasses(sideCount: number): string[] {
  switch (Math.max(0, Math.min(4, Math.floor(sideCount)))) {
    case 1:
      return ['col-span-2 row-span-2'];
    case 2:
      return ['col-span-2', 'col-span-2'];
    case 3:
      return ['col-span-2', '', ''];
    case 4:
      return ['', '', '', ''];
    default:
      return [];
  }
}

const NEEDS_A_PHOTO =
  'Add at least one photo — the page leads with a photo, and a video can’t come first.';

/**
 * The first problem with a list of photos, videos and links (any activity's, not only a package's), or null:
 * videos or links with no photo at all leave nothing to put first, so `images[0]` would be a video and every
 * card would show a broken image. A video that merely sits in front of a photo is fine — `ensureImageLead`
 * moves the photo up when the images are written. Blank rows are ignored.
 */
export function validateLeadPhoto(items: readonly { url: string }[]): string | null {
  const urls = items.map((i) => i.url.trim()).filter(Boolean);
  const hasVideo = urls.some((u) => mediaKind(u) !== 'image');
  const hasPhoto = urls.some((u) => mediaKind(u) === 'image');
  return hasVideo && !hasPhoto ? NEEDS_A_PHOTO : null;
}

/**
 * The first problem with a package's photos and videos, or null. The cover must be a photo, and videos need
 * a photo to lead the page — otherwise `images[0]` would be a video and every card would show a broken image.
 */
export function validatePackageMedia(
  cover: string,
  gallery: readonly { url: string }[],
): string | null {
  const c = cover.trim();
  if (c && mediaKind(c) !== 'image') {
    return 'The cover has to be a photo — a video or a link can’t be the cover. Put it in the gallery instead.';
  }
  // A photo cover already leads the page; with no cover, the gallery has to supply the photo.
  return c ? null : validateLeadPhoto(gallery);
}
