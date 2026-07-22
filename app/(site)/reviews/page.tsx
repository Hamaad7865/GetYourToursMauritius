import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import { InfoPage } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { ReviewCard } from '@/components/site/ReviewCard';
import { RevealGroup } from '@/components/site/RevealGroup';
import { loadFeaturedReviews, loadReviewStats } from '@/lib/content/guest-reviews-live';
import { breadcrumbListJsonLd, reviewsPageJsonLd } from '@/lib/seo/jsonld';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import { IconStar } from '@/components/ui/icons';

export const runtime = 'edge';

// Single source of truth — the same URLs feed schema.org `sameAs` via SITE.profiles, so the page and
// the structured data can't drift apart.
const TA_URL = SITE.profiles.tripadvisor;
const GOOGLE_URL = SITE.profiles.google;

const TITLE = 'Belle Mare Tours Reviews — 4.8/5 from 1,000+ Guests';
const DESCRIPTION =
  'Read real reviews of Belle Mare Tours from TripAdvisor and Google — rated 4.8 out of 5 from more than 1,000 guests for catamaran cruises, dolphin swims, island day tours, sightseeing and airport transfers in Mauritius.';

const DEFAULT_METADATA: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    'Belle Mare Tours reviews',
    'Mauritius tour reviews',
    'Belle Mare Tours TripAdvisor',
    'Mauritius taxi reviews',
  ],
  alternates: { canonical: '/reviews' },
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE.url}/reviews`,
    locale: 'en_GB',
    images: [OG_IMAGE],
  },
};

function Bar({ stars, count, total }: { stars: number; count: number; total: number }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5 text-[12.5px]">
      <span className="w-9 shrink-0 text-ink-muted">{stars}★</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
        <span className="block h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-9 shrink-0 text-right text-ink-muted">{count}</span>
    </div>
  );
}

export default async function ReviewsPage() {
  const [reviewStats, featuredReviews] = await Promise.all([
    loadReviewStats(),
    loadFeaturedReviews(),
  ]);
  const histTotal = Object.values(reviewStats.histogram).reduce((a, b) => a + b, 0) || 1;
  const jsonld = reviewsPageJsonLd(
    reviewStats,
    featuredReviews
      .slice(0, 12)
      .map((r) => ({ author: r.author, rating: r.rating, text: r.text, date: r.date })),
  );

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Reviews', path: '/reviews' },
        ])}
      />
      <JsonLd data={jsonld} />

      <InfoPage eyebrow="Guest reviews" title="Belle Mare Tours reviews" intro={DESCRIPTION}>
        {/* Summary */}
        <div className="grid gap-6 rounded-2xl border border-ink/10 bg-cream/50 p-6 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-10">
          <div className="text-center">
            <div className="font-display text-[52px] font-extrabold leading-none text-ink">
              {reviewStats.average}
            </div>
            <div className="mt-1.5 flex justify-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <IconStar key={i} width={18} height={18} className="text-gold-light" />
              ))}
            </div>
            <div className="mt-1.5 text-[13px] text-ink-muted">
              {reviewStats.total.toLocaleString()} reviews
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-col gap-1.5">
              {[5, 4, 3, 2, 1].map((s) => (
                <Bar
                  key={s}
                  stars={s}
                  count={reviewStats.histogram[String(s)] ?? 0}
                  total={histTotal}
                />
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink/70">
              <a
                href={TA_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-teal"
              >
                <b className="text-ink">{reviewStats.tripadvisor.rating}</b> ·{' '}
                {reviewStats.tripadvisor.count} on TripAdvisor
              </a>
              <a
                href={GOOGLE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-teal"
              >
                <b className="text-ink">{reviewStats.google.rating}</b> · {reviewStats.google.count}{' '}
                on Google
              </a>
            </div>
          </div>
        </div>

        <p className="mt-5 text-[13.5px] text-ink-muted">
          These are real, unedited reviews collected on TripAdvisor and Google. Click any review to
          read it on the original platform.
        </p>

        {/* Reviews grid */}
        <RevealGroup className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featuredReviews.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </RevealGroup>
      </InfoPage>
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/reviews', DEFAULT_METADATA);
}
