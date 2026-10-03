/**
 * Shared `sizes` + width ladders for the layouts that recur, so every component that shows a photo the
 * same way asks Cloudflare for the SAME resized files. That matters twice: the browser caches one copy
 * instead of several, and each distinct (photo, width) is one of the 5,000 free "unique transformations" a
 * month — two cards using different ladders would double the count for nothing.
 *
 * `sizes` must describe how wide the image is LAID OUT (see resize.ts); a wrong one only costs bytes
 * (too big) or sharpness (too small), never correctness.
 */

/** A photo card in a 1–4 column grid or rail: ~300 px on desktop, about half the viewport on a tablet,
 *  nearly all of it on a phone. */
export const PHOTO_CARD = {
  sizes: '(min-width: 1280px) 300px, (min-width: 1024px) 31vw, (min-width: 640px) 46vw, 92vw',
  widths: [400, 800, 1200],
} as const;

/** A tiny square (search suggestion, an option's 40 px picture): the smallest step is plenty. */
export const PHOTO_THUMB = { sizes: '64px', widths: [400] } as const;

/** A full-bleed banner: as wide as the screen. */
export const PHOTO_BANNER = { sizes: '100vw', widths: [800, 1200, 1600, 2400] } as const;
