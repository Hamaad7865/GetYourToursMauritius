/**
 * Every photograph on the About page, in one place.
 *
 * WHY THIS FILE EXISTS: swapping the About page over to Belle Mare Tours' own photography should be
 * a one-file edit, not a hunt through a 1,200-line page. Replace the `src` values below and the page
 * re-skins itself.
 *
 * LICENSING — read before adding anything here. Every image must be one we can prove we may use:
 *   • These are Pexels photos, already in the repo with full provenance in public/blog/credits.json
 *     (photographer + source URL per file). The Pexels licence permits commercial use.
 *   • Do NOT source images from `Activity Pictures/` — that folder contains third-party stock
 *     (including a Shutterstock file) and Google-Images downloads, none of it licensed to us.
 *   • public/hero/hero-blue.jpg (visible watermark) and public/hero/airport-arrival.jpg (unlicensed
 *     Adobe comp) are known-bad and must not be reused.
 *
 * HONESTY — these are generic island stock shots, and their filenames do NOT reliably describe what
 * they show (the file named for Île aux Cerfs actually pictures Trou-aux-Biches; the one named for
 * Flic en Flac pictures Le Morne). So they're used ATMOSPHERICALLY only — never captioned as, or
 * placed next to, a claim about a specific named place. The `alt` text below describes what is
 * genuinely in frame, taken from credits.json. When real Belle Mare Tours photography replaces
 * these, that constraint lifts and the region cards can carry true location photos.
 */

export interface AboutPhoto {
  src: string;
  /** Describes what is actually in frame — never asserts a location we cannot verify. */
  alt: string;
  /** For the credit line; Pexels does not require attribution, but we show it anyway. */
  photographer: string;
}

/** The statement image behind the pull-quote band. Wide, calm, no landmark to misattribute. */
export const BAND_PHOTO: AboutPhoto = {
  src: '/blog/sunset-spots-mauritius.webp',
  alt: 'Sunrise over sugar-cane fields in Mauritius with a mountain ridge behind',
  photographer: "Ali's Captured Moments",
};

/** The "Our story" collage: one tall lead, one square inset, one small accent. */
export const STORY_PHOTOS: readonly AboutPhoto[] = [
  {
    src: '/blog/catamaran-cruises-mauritius.webp',
    alt: 'A sailboat and a windsurfer on a bright Mauritian lagoon',
    photographer: "Sean O'Brien",
  },
  {
    src: '/blog/snorkeling-in-mauritius.webp',
    alt: 'Clear shallow water over pale sand under a bright sky at Blue Bay',
    photographer: 'Jyoti Pur',
  },
  {
    src: '/blog/best-beaches-in-mauritius.webp',
    alt: 'Palms leaning over calm water on a quiet tropical shore',
    photographer: 'Ricardo Stephan',
  },
];

/** Every photographer credited on the page, de-duplicated, for the discreet footer credit. */
export const PHOTO_CREDITS: readonly string[] = [
  ...new Set([BAND_PHOTO, ...STORY_PHOTOS].map((p) => p.photographer)),
];
