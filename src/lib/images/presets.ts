/**
 * Shared `sizes` + width ladders for the layouts that recur, so every component that shows a photo
 * the same way asks Cloudflare for the SAME resized files. That matters twice: the browser caches one
 * copy instead of several, and each distinct (photo, width) is one of the 5,000 free "unique
 * transformations" a month — two cards using different ladders would double the count for nothing.
 * Every ladder below is drawn from the same four steps (400, 800, 1200, 1600) for that reason.
 *
 * `sizes` must describe how wide the image is LAID OUT (see resize.ts); a wrong one only costs bytes
 * (too big) or sharpness (too small), never correctness.
 */

/** A photo card in a 1–4 column grid or rail: ~300 px on desktop, about half the viewport on a
 *  tablet, nearly all of it on a phone. */
export const PHOTO_CARD = {
  sizes: '(min-width: 1280px) 300px, (min-width: 1024px) 31vw, (min-width: 640px) 46vw, 92vw',
  widths: [400, 800],
} as const;

/** The lead photo of a tour page's gallery: the wide left tile on desktop, the full width on a
 *  phone. This is the page's largest paint. */
export const GALLERY_LEAD = {
  sizes: '(min-width: 1280px) 760px, (min-width: 640px) 60vw, 100vw',
  widths: [400, 800, 1200, 1600],
} as const;

/** One of the four small tiles beside the lead photo (hidden on a phone). */
export const GALLERY_TILE = {
  sizes: '(min-width: 1280px) 240px, 20vw',
  widths: [400, 800],
} as const;

/** The photo at the top of a guide page (an attraction): as wide as the article column. */
export const ARTICLE_HERO = {
  sizes: '(min-width: 1024px) 900px, 100vw',
  widths: [400, 800, 1200],
} as const;
