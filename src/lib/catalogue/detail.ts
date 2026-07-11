import { SITE } from '@/lib/seo/site';
import type { Review, TourDetail, TourSummary } from '@/lib/validation/tours';

/** Human duration label: "min" under an hour, otherwise "h" with at most one decimal. */
export function durationLabel(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes >= 60) {
    const h = Math.round((minutes / 60) * 10) / 10;
    return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
  }
  return `${minutes} min`;
}

export interface Crumb {
  label: string;
  href: string;
}

/** Breadcrumb links (Home → section → category). The page renders the title separately. */
export function breadcrumbTrail(activity: Pick<TourDetail, 'type' | 'category'>): Crumb[] {
  return [
    { label: 'Home', href: '/' },
    {
      label: activity.type === 'transport' ? 'Transfers' : 'Activities',
      href: activity.type === 'transport' ? '/activities?type=transport' : '/activities',
    },
    {
      label: activity.category,
      href: `/activities?category=${encodeURIComponent(activity.category)}`,
    },
  ];
}

export interface QuickFact {
  label: string;
  sub: string;
}

/**
 * Six at-a-glance facts derived strictly from real activity fields — no invented
 * copy. Order mirrors the design's quick-facts grid.
 */
export function quickFacts(activity: TourDetail): QuickFact[] {
  const facts: QuickFact[] = [];
  const duration = durationLabel(activity.durationMinutes);
  if (duration) facts.push({ label: 'Duration', sub: duration });
  if (activity.languages.length > 0) {
    facts.push({ label: 'Live guide', sub: activity.languages.join(', ') });
  }
  facts.push(
    activity.pickupAvailable
      ? { label: 'Hotel pickup', sub: 'Available on request' }
      : { label: 'Meeting point', sub: activity.meetingPoint ?? 'Shared on your voucher' },
  );
  if (activity.cancellationPolicy) {
    facts.push({ label: 'Free cancellation', sub: 'Up to 24h before' });
  }
  facts.push({ label: 'Instant confirmation', sub: 'Voucher by email' });
  if (activity.options.length > 0) {
    facts.push({
      label: activity.type === 'transport' ? 'Vehicles' : 'Options',
      sub: `${activity.options.length} to choose from`,
    });
  }
  return facts.slice(0, 6);
}

export interface Faq {
  q: string;
  a: string;
}

/** FAQ assembled from real fields (cancellation, pickup, languages) + fixed policy answers. */
export function buildFaq(activity: TourDetail): Faq[] {
  const faqs: Faq[] = [];
  if (activity.cancellationPolicy) {
    faqs.push({ q: 'What is the cancellation policy?', a: activity.cancellationPolicy });
  }
  faqs.push({
    q: 'How will I receive my confirmation?',
    a: 'Your booking is confirmed instantly and a voucher is emailed to you. Show it on the day — printed or on your phone.',
  });
  if (activity.pickupAvailable) {
    // Sightseeing (flat per-vehicle price) includes transport; per-person / per-group price hotel
    // pickup as a region-based add-on at checkout — so don't answer a flat "yes, included" there.
    faqs.push(
      activity.pricingMode === 'vehicle'
        ? {
            q: 'Is hotel pickup included?',
            a: `Yes — hotel pickup and drop-off are included in the price. ${
              activity.meetingPoint ? `${activity.meetingPoint}. ` : ''
            }Add your pickup details after booking, up to 24 hours before you go.`,
          }
        : {
            q: 'Is hotel pickup available?',
            a: `Yes — hotel pickup and drop-off are available at an additional cost, calculated from your pickup area at checkout. ${
              activity.meetingPoint ? `${activity.meetingPoint}. ` : ''
            }Add your pickup details after booking, up to 24 hours before you go.`,
          },
    );
  } else if (activity.meetingPoint) {
    faqs.push({ q: 'Where do we meet?', a: activity.meetingPoint });
  }
  if (activity.languages.length > 0) {
    faqs.push({
      q: 'Which languages are available?',
      a: `This experience is guided in ${activity.languages.join(' and ')}.`,
    });
  }
  faqs.push({
    q: 'Can I pay securely online?',
    a: `Yes. Payments are processed securely by Peach Payments — your card is encrypted and never stored by ${SITE.operator}.`,
  });
  return faqs;
}

export interface RatingBar {
  stars: number;
  count: number;
  /** Bar width as a percentage of the most common rating (0–100), for the histogram. */
  widthPct: number;
}

/** Star histogram (5→1) computed from the available review sample. */
export function ratingBreakdown(reviews: Review[]): RatingBar[] {
  const buckets = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: reviews.filter((r) => Math.round(r.rating) === stars).length,
  }));
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return buckets.map((b) => ({ ...b, widthPct: Math.round((b.count / max) * 100) }));
}

/** Same-context suggestions for "you might also like" (excludes the current activity). */
export function relatedActivities(
  candidates: TourSummary[],
  currentSlug: string,
  limit = 3,
): TourSummary[] {
  return candidates.filter((t) => t.slug !== currentSlug).slice(0, limit);
}

/** Money-safe line total (rounded to cents) for the booking-panel quote. */
export function lineTotalEur(unitEur: number, quantity: number): number {
  return Math.round(unitEur * quantity * 100) / 100;
}

/** Initials for an avatar / image fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** BreadcrumbList structured data (absolute URLs) for the detail page. */
export function breadcrumbJsonLd(
  activity: Pick<TourDetail, 'type' | 'category' | 'title' | 'slug'>,
): Record<string, unknown> {
  const trail: Crumb[] = [
    ...breadcrumbTrail(activity),
    { label: activity.title, href: `/activities/${activity.slug}` },
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.label,
      item: `${SITE.url}${crumb.href}`,
    })),
  };
}
