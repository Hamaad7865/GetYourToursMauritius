/**
 * Responsive, resized photos through Cloudflare Image Transformations (`/cdn-cgi/image/...`).
 *
 * WHY: photos live in Supabase Storage at full camera size (the photoshoot package page referenced 53 MB,
 * its main photo alone 6 MB) and `images.unoptimized` means nothing ever resized them. Cloudflare can serve
 * a 400–2400 px AVIF/WebP of the same file from the site's own domain.
 *
 * ROLLOUT — this ships OFF and only the owner turns it on:
 *   1. Cloudflare → Images → Transformations: the zone is enabled, and the owner adds this project's
 *      Supabase host (the origin of `NEXT_PUBLIC_SUPABASE_URL`) to the allowed origins — without that
 *      Cloudflare answers 403 "origin is not in allowed origins list".
 *   2. Repository variable `NEXT_PUBLIC_IMAGE_RESIZING=1`, then a NEW build (it is inlined at build time).
 * Until then every function here hands the original URL back untouched, so the markup is unchanged.
 *
 * Only the site's OWN Supabase project is ever rewritten: that is the one origin the owner allow-lists
 * (a wildcard would let anyone's project spend the free 5,000 transformations a month). Anything else — our
 * static files, other hosts, SVG/GIF/video — is returned as it came.
 *
 * Even when everything is configured a resize can fail (feature off on this host, quota used up, origin
 * blocked). Each rewritten <img> carries `data-src-original`, and the inline script in
 * `./fallback.ts` swaps the original back — Cloudflare's own `onerror=redirect` does nothing for an image
 * on another domain, and a React `onError` misses images that fail before hydration.
 *
 * Pure: no DOM, safe on the server, the client and in tests.
 */

/** Widths offered to the browser. Few on purpose: each distinct (image, width) is one billable
 *  "unique transformation" (5,000 a month free). */
export const IMAGE_WIDTHS = [400, 800, 1200, 1600, 2400] as const;

/** Cloudflare's own quality (the stored file is already web-sized, so this is the one lossy step). */
export const IMAGE_QUALITY = 80;

/** Formats a transform would damage (animation, vectors) or that are not photos at all. */
const NOT_RASTER = /\.(svg|gif|mp4|webm|mov|m4v|ogv|pdf)$/i;

/**
 * The build-time switch. A LITERAL `process.env.NEXT_PUBLIC_…` access on purpose: Next inlines exactly
 * that form into the client bundle — a dynamic key or a destructure comes out `undefined` in the browser.
 */
export function resizingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_IMAGE_RESIZING === '1';
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether `src` is a public photo in THIS site's Supabase project (`supabaseUrl` is that project's URL)
 * and a format that can safely be resized.
 */
export function canResize(src: string, supabaseUrl: string | null | undefined): boolean {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return false; // relative path (our own static file), data: URI, empty, nonsense
  }
  if (u.protocol !== 'https:') return false;
  const project = hostOf(supabaseUrl);
  if (!project || u.host.toLowerCase() !== project) return false;
  if (!u.pathname.startsWith('/storage/v1/object/public/')) return false;
  return !NOT_RASTER.test(u.pathname);
}

/** The same-site transform URL for `src` at `width` CSS-independent pixels (never upscaled). */
export function resizedUrl(src: string, width: number, quality: number = IMAGE_QUALITY): string {
  return `/cdn-cgi/image/width=${width},quality=${quality},format=auto,fit=scale-down/${src}`;
}

export interface ResponsiveImageOptions {
  /** The `sizes` attribute: how wide the image is LAID OUT. Without a real one the browser assumes the
   *  full viewport and picks the biggest file — so every call site gives its own. */
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
 * `<img {...responsiveImage(url, { sizes })} alt=… />`. Switch off, or a source that cannot be resized:
 * just `{ src }`, exactly as before.
 */
export function responsiveImage(src: string, opts: ResponsiveImageOptions): ResponsiveImage {
  const enabled = opts.enabled ?? resizingEnabled();
  if (!enabled || !canResize(src, opts.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return { src };
  }
  const ladder = [
    ...new Set((opts.widths ?? IMAGE_WIDTHS).filter((w) => Number.isFinite(w) && w > 0)),
  ].sort((a, b) => a - b);
  if (ladder.length === 0) return { src };
  // What an old browser or a crawler fetches: the first width that is big enough to look good.
  const plain = ladder.find((w) => w >= 1200) ?? ladder[ladder.length - 1]!;
  return {
    src: resizedUrl(src, plain),
    // "url 400w, url 800w": the option list INSIDE each URL contains commas but no whitespace, so
    // splitting on comma-then-space is what keeps the candidates apart.
    srcSet: ladder.map((w) => `${resizedUrl(src, w)} ${w}w`).join(', '),
    sizes: opts.sizes,
    'data-src-original': src,
  };
}
