import Link from 'next/link';
import { ReviewCard } from '@/components/site/ReviewCard';
import { RevealGroup } from '@/components/site/RevealGroup';
import { reviewStats, transferReviews } from '@/lib/content/reviews';
import { IconStar } from '@/components/ui/icons';

/** "See why guests love us" — our real TripAdvisor + Google reputation, with transfer-relevant reviews. */
export function TransferReviews({ count = 6 }: { count?: number }) {
  const reviews = transferReviews(count);
  if (reviews.length === 0) return null;
  return (
    <section className="mt-12 border-t border-ink/10 pt-9">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
            See why guests love us
          </h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-ink/75">
            <span className="flex items-center gap-1 font-bold text-ink">
              <IconStar width={16} height={16} className="text-gold-light" />
              {reviewStats.average.toFixed(1)}/5
            </span>
            <span className="text-ink-muted">
              from {reviewStats.total.toLocaleString('en-GB')} reviews · TripAdvisor{' '}
              {reviewStats.tripadvisor.rating.toFixed(1)} · Google{' '}
              {reviewStats.google.rating.toFixed(1)}
            </span>
          </p>
        </div>
        <Link href="/reviews" className="text-sm font-bold text-teal hover:text-teal-dark">
          Read all reviews →
        </Link>
      </div>
      <RevealGroup className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
      </RevealGroup>
    </section>
  );
}
