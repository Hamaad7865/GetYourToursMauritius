import type { Review } from '@/lib/validation/tours';
import { initials, ratingBreakdown } from '@/lib/catalogue/detail';
import { IconStar } from '@/components/ui/icons';

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const filled = Math.round(value);
  return (
    <span className="flex gap-0.5" aria-label={`${filled} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <IconStar
          key={n}
          width={size}
          height={size}
          className={n <= filled ? 'text-gold-light' : 'text-ink/15'}
        />
      ))}
    </span>
  );
}

function reviewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** Guest-review block: aggregate score, star histogram and individual review cards. */
export function ReviewList({
  ratingAvg,
  ratingCount,
  reviews,
}: {
  ratingAvg: number | null;
  ratingCount: number;
  reviews: Review[];
}) {
  if (ratingCount === 0 && reviews.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No reviews yet — be the first to share your experience.
      </p>
    );
  }

  const bars = ratingBreakdown(reviews);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-7 rounded-card border border-ink/[0.08] bg-white p-5">
        <div className="shrink-0 text-center">
          <div className="text-[46px] font-extrabold leading-none tracking-tight text-ink">
            {ratingAvg?.toFixed(1) ?? '—'}
          </div>
          <div className="my-2 flex justify-center">
            <Stars value={ratingAvg ?? 0} size={16} />
          </div>
          <div className="text-xs text-ink-muted">{ratingCount} reviews</div>
        </div>
        {reviews.length > 0 && (
          <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            {bars.map((bar) => (
              <div key={bar.stars} className="flex items-center gap-2.5">
                <span className="flex w-8 items-center gap-1 text-xs text-ink-muted">
                  {bar.stars}
                  <IconStar width={11} height={11} className="text-gold-light" />
                </span>
                <span className="h-[7px] flex-1 overflow-hidden rounded bg-ink/[0.07]">
                  <span
                    className="block h-full rounded bg-gold-light"
                    style={{ width: `${bar.widthPct}%` }}
                  />
                </span>
                <span className="w-9 text-right text-xs text-ink-muted">{bar.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {reviews.length > 0 && (
        <div className="flex flex-col gap-4">
          {reviews.map((review) => (
            <article
              key={review.id}
              className="rounded-[15px] border border-ink/[0.08] bg-white p-[17px]"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-tint text-sm font-bold text-teal-dark">
                  {initials(review.author)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-ink">{review.author}</div>
                  <div className="text-xs text-ink-muted">{reviewDate(review.createdAt)}</div>
                </div>
                <Stars value={review.rating} size={13} />
              </div>
              {review.text && (
                <p className="mt-3 text-sm leading-relaxed text-ink/80">{review.text}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
