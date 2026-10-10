/* Wikimedia Commons image URLs: sizing them down and serving them through our own proxy.
 * Pure and dependency-free on purpose — the header's menu loads this in the browser, and the module
 * that used to hold the proxy rule (attractions.ts) drags the whole attraction guide in with it. */

/**
 * A Wikimedia Commons URL at thumbnail size. The stored URLs are 1280px renditions (or, for a few,
 * the multi-megabyte original) — far more than a tile or a menu thumbnail needs. `width` should be
 * one of Wikimedia's standard sizes (120, 250, 330, 500, 960, 1280…); other widths may be refused.
 * Any other URL (our own /public photos) is returned unchanged.
 */
export function wikimediaThumb(url: string, width: number): string {
  const sized = url.match(/^(https:\/\/upload\.wikimedia\.org\/.+\/thumb\/.+\/)\d+px-([^/]+)$/);
  if (sized) return `${sized[1]}${width}px-${sized[2]}`;
  const original = url.match(
    /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/,
  );
  if (original)
    return `${original[1]}/thumb/${original[2]}/${original[3]}/${width}px-${original[3]}`;
  return url;
}

/**
 * The src to actually render for a remote photo. Wikimedia thumbnails are hot-linked from
 * upload.wikimedia.org, which rate-limits (429) the ~20-image burst a single page load fires — so route
 * those through our cached /api/img proxy (served from our own edge, fetched from Wikimedia at most once
 * per POP). Local/own photos and any other host are returned unchanged.
 */
export function proxiedImageSrc(url: string): string {
  try {
    if (new URL(url, 'https://x').hostname === 'upload.wikimedia.org') {
      return `/api/img?u=${encodeURIComponent(url)}`;
    }
  } catch {
    /* not an absolute URL — a local /public path; use it directly */
  }
  return url;
}
