import type { Review } from '@/lib/validation/tours';
import { initials, ratingBreakdown } from '@/lib/catalogue/detail';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatLocaleDate } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import { IconStar } from '@/components/ui/icons';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function Stars({ value, size = 14, t }: { value: number; size?: number; t: Translate }) {
  const filled = Math.round(value);
  return (
    <span className="flex gap-0.5" aria-label={t('{n} out of 5 stars', { n: filled })}>
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

function reviewDate(iso: string, locale: Locale): string {
  return formatLocaleDate(iso, locale, { month: 'short', year: 'numeric' });
}

/** Guest-review block: aggregate score, star histogram and individual review cards. */
export async function ReviewList({
  ratingAvg,
  ratingCount,
  reviews,
}: {
  ratingAvg: number | null;
  ratingCount: number;
  reviews: Review[];
}) {
  const t = await getT();
  const locale = await getLocale();
  if (ratingCount === 0 && reviews.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        {t('No reviews yet — be the first to share your experience.')}
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
            <Stars value={ratingAvg ?? 0} size={16} t={t} />
          </div>
          <div className="text-xs text-ink-muted">{t('{n} reviews', { n: ratingCount })}</div>
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
                  <div className="text-xs text-ink-muted">{reviewDate(review.createdAt, locale)}</div>
                </div>
                <Stars value={review.rating} size={13} t={t} />
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
