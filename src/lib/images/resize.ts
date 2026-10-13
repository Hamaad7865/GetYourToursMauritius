/**
 * Responsive, resized photos through Cloudflare Image Transformations (`/cdn-cgi/image/...`).
 *
 * WHY: `images.unoptimized` means nothing ever resized a photo. Tour photos live in Supabase Storage
 * as uploaded, and every card and every tour page downloaded the original to fill a thumbnail — the
 * seaplane page's lead photo is 668 KB, the catalogue's cards 19 MB between them. Most visitors are on
 * a phone. Cloudflare can serve a 400–1600 px AVIF/WebP of the same file from the site's own domain:
 * measured on production (2026-10-13), a 197 KB photo came back as 41 KB.
 *
 * HOW THE PHOTO REACHES CLOUDFLARE: it only transforms a source on the zone itself, or on an origin
 * the account has allow-listed. Supabase is neither — a direct Supabase URL answers 403 (error 9401).
 * So the source handed to Cloudflare is our own image proxy, `/api/img?u=<photo>`, which IS on the
 * zone. That needs no account setting, and it is why `isOwnPublicPhoto` below is shared with the proxy
 * route: this module must never build a URL the proxy would refuse.
 *
 * WHERE IT IS ON: a production build served from a real domain. `next dev`, a `*.pages.dev` preview
 * and localhost have no `/cdn-cgi/image` (404), so there the functions here hand the original URL
 * back and the markup is unchanged. `NEXT_PUBLIC_IMAGE_RESIZING=0` switches it off everywhere (the
 * kill switch); `=1` forces it on.
 *
 * Even when everything is right a resize can fail — the free plan stops at 5,000 distinct
 * (photo, width) pairs a month. Each rewritten <img> carries `data-src-original`, and the inline
 * script in `./fallback.ts` puts the original back: a React `onError` misses images that fail before
 * hydration.
 *
 * Pure: no DOM, safe on the server, the client and in tests.
 */

/** Widths offered to the browser. Few on purpose: each distinct (image, width) is one "unique
 *  transformation", and the free plan allows 5,000 a month. */
export const IMAGE_WIDTHS = [400, 800, 1200, 1600] as const;

/** Cloudflare's own quality — the one lossy step. */
export const IMAGE_QUALITY = 80;

/** Our image proxy (app/api/img/route.ts). */
const PROXY = '/api/img?u=';

/** Formats a transform would damage (animation, vectors) or that are not photos at all. */
const NOT_RASTER = /\.(svg|gif|mp4|webm|mov|m4v|ogv|pdf)$/i;

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether this build is served from a domain that has Cloudflare Image Transformations.
 *
 * LITERAL `process.env.NEXT_PUBLIC_…` accesses on purpose: Next inlines exactly that form into the
 * client bundle — a dynamic key or a destructure comes out `undefined` in the browser.
 */
export function resizingEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_IMAGE_RESIZING;
  if (flag === '0') return false;
  if (flag === '1') return true;
  // `next dev` often runs behind a tunnel with a real-looking https name; nothing there resizes.
  if (process.env.NODE_ENV !== 'production') return false;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const host = hostOf(site);
  if (!host || !site?.trim().startsWith('https://')) return false;
  if (host.endsWith('.pages.dev') || host.endsWith('.workers.dev')) return false;
  return !host.startsWith('localhost') && !host.startsWith('127.');
}

/**
 * Whether `url` is a public photo in THIS site's Supabase project (`supabaseUrl` is that project's
 * URL). The proxy route uses this same test to decide what it will fetch — exactly one host, public
 * storage only, so it cannot be turned into an open proxy or made to read a private file.
 */
export function isOwnPublicPhoto(url: string, supabaseUrl: string | null | undefined): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false; // relative path, data: URI, empty, nonsense
  }
  if (u.protocol !== 'https:') return false;
  const project = hostOf(supabaseUrl);
  if (!project || u.host.toLowerCase() !== project) return false;
  return u.pathname.startsWith('/storage/v1/object/public/');
}

/**
 * The same-site path Cloudflare should read `src` from, or null when `src` is not something to
 * resize: one of our own Supabase photos (sent through the proxy), or an image that already comes
 * through the proxy (the Wikimedia attraction photos).
 */
export function resizeSource(src: string, supabaseUrl: string | null | undefined): string | null {
  if (src.startsWith(PROXY)) {
    let proxied: string;
    try {
      proxied = decodeURIComponent(src.slice(PROXY.length));
    } catch {
      return null;
    }
    return NOT_RASTER.test(proxied.split(/[?#]/)[0] ?? '') ? null : src;
  }
  if (!isOwnPublicPhoto(src, supabaseUrl)) return null;
  if (NOT_RASTER.test(new URL(src).pathname)) return null;
  return `${PROXY}${encodeURIComponent(src)}`;
}

/** Whether `src` can be resized at all. */
export function canResize(src: string, supabaseUrl: string | null | undefined): boolean {
  return resizeSource(src, supabaseUrl) !== null;
}

/**
 * The transform URL for a same-site `source` path (from {@link resizeSource}) at `width` pixels —
 * never upscaled. The source is appended as it stands: it begins with "/", and its query string
 * belongs to the proxy, not to Cloudflare.
 */
export function resizedUrl(source: string, width: number, quality: number = IMAGE_QUALITY): string {
  return `/cdn-cgi/image/width=${width},quality=${quality},format=auto,fit=scale-down${source}`;
}

export interface ResponsiveImageOptions {
  /** The `sizes` attribute: how wide the image is LAID OUT. Without a real one the browser assumes
   *  the full viewport and picks the biggest file — so every call site gives its own. */
  sizes: string;
  /** Candidate widths (default {@link IMAGE_WIDTHS}). */
  widths?: readonly number[];
  /** Override the build switch (tests). */
  enabled?: boolean;
  /** Override the project the build is wired to (tests). */
  supabaseUrl?: string | null;
}

/** Attributes to spread onto an <img>: always a `src`, plus the rest only when a resize applies. */
export interface ResponsiveImage {
  src: string;
  srcSet?: string;
  sizes?: string;
  /** Read by the fallback script when the resized URL fails to load. */
  'data-src-original'?: string;
}

/**
 * `<img {...responsiveImage(url, { sizes })} alt=… />`. Resizing off, or a source that cannot be
 * resized: just `{ src }`, exactly as before.
 */
export function responsiveImage(src: string, opts: ResponsiveImageOptions): ResponsiveImage {
  const enabled = opts.enabled ?? resizingEnabled();
  if (!enabled) return { src };
  const source = resizeSource(src, opts.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!source) return { src };
  const ladder = [
    ...new Set((opts.widths ?? IMAGE_WIDTHS).filter((w) => Number.isFinite(w) && w > 0)),
  ].sort((a, b) => a - b);
  if (ladder.length === 0) return { src };
  // What an old browser or a crawler fetches: the first width that is big enough to look good.
  const plain = ladder.find((w) => w >= 1200) ?? ladder[ladder.length - 1]!;
  return {
    src: resizedUrl(source, plain),
    // "url 400w, url 800w": the option list INSIDE each URL contains commas but no whitespace (the
    // proxied address is percent-encoded), so comma-then-space is what keeps the candidates apart.
    srcSet: ladder.map((w) => `${resizedUrl(source, w)} ${w}w`).join(', '),
    sizes: opts.sizes,
    'data-src-original': src,
  };
}
