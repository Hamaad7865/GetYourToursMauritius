import Link from 'next/link';
import { topReviews, reviewStats } from '@/lib/content/reviews';
import { ReviewCard } from './ReviewCard';
import { RevealGroup } from './RevealGroup';

/** "What our guests say" — a strip of real reviews on the homepage. */
export function FeaturedReviews() {
  const reviews = topReviews(6);
  if (reviews.length === 0) return null;
  return (
    <section className="mx-auto max-w-shell px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[clamp(22px,3vw,30px)] font-extrabold tracking-tight text-ink">
            What our guests say
          </h2>
          <p className="mt-1 text-[14.5px] text-ink/70">
            Rated {reviewStats.average}/5 from {reviewStats.total.toLocaleString()} reviews on TripAdvisor &amp; Google.
          </p>
        </div>
        <Link href="/reviews" className="text-sm font-bold text-teal hover:text-teal-dark">
          Read all reviews →
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
