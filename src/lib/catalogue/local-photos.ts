import type { TourImage, TourSummary } from '@/lib/validation/tours';

/**
 * Curated real photography served straight from `public/` (so it works in dev and on
 * Cloudflare Pages with no Supabase Storage upload). When a slug appears here these photos
 * REPLACE whatever `activity_images` the catalogue returned, so the card carousel and the
 * detail gallery show the real imagery. Once the same photos are uploaded to Supabase
 * Storage and wired into `activity_images`, the DB rows take over and this becomes a no-op
 * for that slug — remove the entry then.
 */
const LOCAL_PHOTOS: Record<string, ReadonlyArray<{ url: string; alt: string }>> = {
  'north-tour': [
    { url: '/activities/north-tour/1-pamplemousses-garden.jpg', alt: 'Giant water lilies at the SSR Botanical Garden, Pamplemousses' },
    { url: '/activities/north-tour/2-port-louis-caudan-umbrellas.jpg', alt: 'Colourful umbrella street at Le Caudan Waterfront, Port Louis' },
    { url: '/activities/north-tour/3-port-louis-central-market.jpg', alt: 'Port Louis Central Market' },
    { url: '/activities/north-tour/4-pereybere-beach.jpg', alt: 'Turquoise lagoon at Pereybère Beach on the north coast' },
    { url: '/activities/north-tour/5-cap-malheureux.avif', alt: 'Cap Malheureux at the northern tip of Mauritius' },
  ],
};

function localImages(slug: string): TourImage[] | null {
  const photos = LOCAL_PHOTOS[slug];
  if (!photos) return null;
  return photos.map((p, i) => ({ id: `${slug}-local-${i}`, url: p.url, alt: p.alt, position: i }));
}

/**
 * Overlay curated local photos onto an activity when we have them. Generic over the summary
 * shape, so it works for both `TourSummary` (cards) and `TourDetail` (gallery), which share
 * the `images` + `heroImage` fields.
 */
export function withLocalPhotos<T extends TourSummary>(activity: T): T {
  const images = localImages(activity.slug);
  if (!images) return activity;
  return { ...activity, images, heroImage: images[0] ?? activity.heroImage };
}
