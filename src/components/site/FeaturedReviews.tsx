import Link from 'next/link';
import { topReviews, reviewStats } from '@/lib/content/reviews';
import { getT } from '@/lib/i18n/server';
import { ReviewCard } from './ReviewCard';
import { RevealGroup } from './RevealGroup';

/** "What our guests say" — a strip of real reviews on the homepage. */
export async function FeaturedReviews() {
  const t = await getT();
  const reviews = topReviews(6);
  if (reviews.length === 0) return null;
  return (
    <section className="mx-auto max-w-shell px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[clamp(22px,3vw,30px)] font-extrabold tracking-tight text-ink">
            {t('What our guests say')}
          </h2>
          <p className="mt-1 text-[14.5px] text-ink/70">
            {t('Rated {avg}/5 from {total} reviews on TripAdvisor & Google.', {
              avg: reviewStats.average,
              total: reviewStats.total.toLocaleString(),
            })}
          </p>
        </div>
        <Link href="/reviews" className="text-sm font-bold text-teal hover:text-teal-dark">
          {t('Read all reviews →')}
        </Link>
      </div>
      <RevealGroup className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
      </RevealGroup>
    </section>
  );
}
