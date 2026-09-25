/**
 * Uploaded video files play inline; everything else renders as an image. Extension-based on
 * purpose: activity/booking photos carry no media-type column, so the URL is the only signal.
 * Pure — safe on the server, the client and in tests.
 */

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

/** True when `url` points at an uploaded video file (not a YouTube/Vimeo page). */
export function isVideoUrl(url: string): boolean {
  try {
    return VIDEO_EXT.test(new URL(url, 'https://placeholder.invalid').pathname);
  } catch {
    return VIDEO_EXT.test(url);
  }
}

/**
 * Gallery order for package pages: videos first (the lead tile plays), then photos — stable, so
 * the owner's relative order within each kind is kept. The cover stays untouched: it is always
 * images[0] (an image-only upload), which is what cards, search and SEO read.
 */
export function videosFirst<T extends { url: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(isVideoUrl(b.url)) - Number(isVideoUrl(a.url)));
}
