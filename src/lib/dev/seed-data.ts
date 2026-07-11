/**
 * DEV / PREVIEW ONLY — never used when Supabase is configured (see seed-rpc.ts).
 *
 * Maps the committed `seed/catalogue.json` into the DTO shapes the catalogue pages
 * expect, so the app can be reviewed locally before a real Supabase project exists.
 * The real catalogue has no imagery, ratings or reviews yet, so this fixture adds
 * DETERMINISTIC placeholder photos (picsum), ratings and sample reviews purely to
 * exercise the UI. None of this is real content and none of it is committed as seed.
 */
import rawCatalogue from '../../../seed/catalogue.json';
import { catalogueSchema, type SeedActivity } from '@/lib/seed/schema';
import {
  tourDetailSchema,
  tourSummarySchema,
  type Review,
  type TourDetail,
  type TourSummary,
} from '@/lib/validation/tours';

const catalogue = catalogueSchema.parse(rawCatalogue);

/** Tiny stable string hash so every derived placeholder is deterministic per slug. */
function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

const REVIEW_POOL: Array<{ author: string; rating: number; text: string }> = [
  {
    author: 'Priya R.',
    rating: 5,
    text: 'Absolutely the highlight of our trip — the crew were warm and the lagoon was unreal.',
  },
  {
    author: 'James W.',
    rating: 5,
    text: 'Smooth from booking to drop-off. Great value booking direct with the operator.',
  },
  {
    author: 'Camille L.',
    rating: 4,
    text: 'Beautiful day out. A little crowded at the island but the BBQ made up for it.',
  },
  {
    author: 'Daniel K.',
    rating: 5,
    text: 'Punctual pickup and a fantastic guide. Would do it again in a heartbeat.',
  },
  {
    author: 'Sophie M.',
    rating: 5,
    text: 'Snorkelling spots were stunning and the team looked after the kids brilliantly.',
  },
];

function placeholderImages(activity: SeedActivity) {
  if (activity.images.length > 0) {
    return activity.images
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((img) => ({
        id: `${activity.slug}-img-${img.position}`,
        url: img.url,
        alt: img.alt,
        position: img.position,
      }));
  }
  return Array.from({ length: 4 }, (_, i) => ({
    id: `${activity.slug}-img-${i}`,
    url: `https://picsum.photos/seed/${activity.slug}-${i}/900/675`,
    alt: activity.title,
    position: i,
  }));
}

function placeholderReviews(activity: SeedActivity, count: number): Review[] {
  const base = hash(activity.slug);
  return Array.from({ length: count }, (_, i) => {
    const pick = REVIEW_POOL[(base + i * 7) % REVIEW_POOL.length]!;
    const month = ((base + i) % 12) + 1;
    return {
      id: `${activity.slug}-rev-${i}`,
      author: pick.author,
      rating: pick.rating,
      text: pick.text,
      createdAt: `2026-${String(month).padStart(2, '0')}-12T10:00:00Z`,
    };
  });
}

function fromPriceEur(activity: SeedActivity): number | null {
  const amounts = activity.options.flatMap((o) => o.prices.map((p) => p.amount_minor));
  return amounts.length > 0 ? Math.min(...amounts) / 100 : null;
}

function ratingFor(activity: SeedActivity): { avg: number; count: number } {
  const h = hash(activity.slug);
  return { avg: 4.6 + (h % 4) / 10, count: 40 + (h % 1160) };
}

function toSummary(activity: SeedActivity): TourSummary {
  const rating = ratingFor(activity);
  const images = placeholderImages(activity);
  return tourSummarySchema.parse({
    id: activity.slug,
    slug: activity.slug,
    type: activity.type,
    title: activity.title,
    summary: activity.summary,
    category: activity.category,
    location: activity.location,
    durationMinutes: activity.duration_minutes,
    fromPriceEur: fromPriceEur(activity),
    ratingAvg: Math.round(rating.avg * 10) / 10,
    ratingCount: rating.count,
    heroImage: images[0] ?? null,
    images,
  });
}

function toDetail(activity: SeedActivity): TourDetail {
  const summary = toSummary(activity);
  return tourDetailSchema.parse({
    ...summary,
    description:
      activity.description ??
      `${activity.summary ?? activity.title} Booked direct with Belle Mare Tours — no reseller markup, instant confirmation and a friendly local team.`,
    meetingPoint:
      activity.meeting_point ??
      (activity.pickup_available
        ? 'Hotel pickup across the east coast'
        : 'Belle Mare public beach'),
    pickupAvailable: activity.pickup_available,
    languages: activity.fr ? ['English', 'French'] : ['English'],
    inclusions: activity.inclusions,
    exclusions: activity.exclusions,
    highlights: activity.highlights,
    cancellationPolicy: 'Free cancellation up to 24 hours before your activity for a full refund.',
    seoTitle: null,
    seoDescription: null,
    images: placeholderImages(activity),
    options: activity.options.map((option, i) => ({
      id: `${activity.slug}-opt-${i}`,
      name: option.name,
      description: null,
      prices: option.prices.map((price, j) => ({
        id: `${activity.slug}-opt-${i}-price-${j}`,
        label: price.label,
        amountEur: price.amount_minor / 100,
        maxGuests: price.max_guests,
      })),
    })),
    translations: {
      en: { title: activity.title, summary: activity.summary, description: activity.description },
      ...(activity.fr
        ? {
            fr: {
              title: activity.fr.title,
              summary: activity.fr.summary ?? null,
              description: activity.fr.description ?? null,
            },
          }
        : {}),
    },
    reviews: placeholderReviews(activity, 3),
  });
}

const published = catalogue.activities.filter((a) => a.status === 'published');

/** All published activities as summaries, ordered like the SQL (rating desc, then title). */
export const SEED_SUMMARIES: TourSummary[] = published
  .map(toSummary)
  .sort((a, b) => b.ratingCount - a.ratingCount || a.title.localeCompare(b.title));

/** slug → full detail. */
export const SEED_DETAILS: Record<string, TourDetail> = Object.fromEntries(
  published.map((a): [string, TourDetail] => [a.slug, toDetail(a)]),
);
