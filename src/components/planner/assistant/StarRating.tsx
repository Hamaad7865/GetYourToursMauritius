'use client';

import { useT } from '@/components/site/PreferencesProvider';

const STAR =
  'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9L12 2.6Z';

/**
 * A rating as five stars, filled to the decimal, with the number of reviews behind it and — always —
 * whose rating it is. A Google place shows Google's figure and says so; one of our own tours shows
 * our guest reviews. The two are never blended or left unlabelled.
 */
export function StarRating({
  rating,
  count,
  source,
  size = 14,
}: {
  rating: number;
  count: number;
  source: 'google' | 'guests';
  size?: number;
}) {
  const t = useT();
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  const sourceLabel = source === 'google' ? t('on Google') : t('guest reviews');
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-ink"
      // One sentence for a screen reader instead of five decorative stars.
      role="img"
      aria-label={t('Rated {rating} out of 5 from {count} reviews, {source}', {
        rating: rating.toFixed(1),
        count: count.toLocaleString('en'),
        source: sourceLabel,
      })}
    >
      <span className="font-bold tabular-nums">{rating.toFixed(1)}</span>
      <span
        className="relative inline-block leading-none"
        style={{ width: size * 5, height: size }}
      >
        <Stars size={size} className="text-ink/15" />
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}>
          <Stars size={size} className="text-gold" />
        </span>
      </span>
      <span className="tabular-nums text-ink-muted">({count.toLocaleString('en')})</span>
      <span className="text-ink-muted">{sourceLabel}</span>
    </span>
  );
}

function Stars({ size, className }: { size: number; className: string }) {
  return (
    <svg
      width={size * 5}
      height={size}
      viewBox="0 0 120 24"
      aria-hidden="true"
      className={`block max-w-none ${className}`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={STAR} fill="currentColor" transform={`translate(${i * 24} 0)`} />
      ))}
    </svg>
  );
}
