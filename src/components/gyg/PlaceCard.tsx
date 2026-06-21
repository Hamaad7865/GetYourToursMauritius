'use client';

import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { WishHeart } from './WishHeart';
import { Price } from '@/components/site/Price';
import { useT } from '@/components/site/PreferencesProvider';
import { IconCalendar, IconStar } from '@/components/ui/icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

type T = (key: string, vars?: Record<string, string | number>) => string;

function durationLabel(minutes: number | null, t: T): string | null {
  if (minutes == null) return null;
  if (minutes < 60) return t('{n} min', { n: minutes });
  const h = minutes / 60;
  const rounded = Number.isInteger(h) ? h : Math.round(h * 10) / 10;
  return rounded === 1 ? t('{n} hour', { n: rounded }) : t('{n} hours', { n: rounded });
}

/**
 * Activity card, recoloured to the Belle Mare brand. Every card shows a single photo (the
 * activity's hero image) — no carousel — so all cards look identical regardless of how many
 * photos an activity has. The only hover effect is a gentle zoom on the photo; the card and
 * its text never move. The whole card is a stretched link to the detail page.
 */
export function PlaceCard({
  activity,
  rail = false,
  compact = false,
  className = '',
  titleAs: TitleTag = 'h3',
}: {
  activity: TourSummary;
  rail?: boolean;
  /** Shorter, narrower card for the hero "Continue planning" rail so it fits above the fold. */
  compact?: boolean;
  className?: string;
  /** Heading level for the card title, so it nests correctly under the surrounding heading. */
  titleAs?: 'h2' | 'h3' | 'h4';
}) {
  const t = useT();
  const image = activity.heroImage ?? activity.images[0] ?? null;

  const topRated = activity.ratingAvg != null && activity.ratingAvg >= 4.7;
  // Price unit follows what staff set: a transfer or a vehicle-priced sightseeing tour reads "per
  // vehicle"; per-group reads "per group up to N"; otherwise it's per person.
  const groupSize = activity.fromPriceMaxGuests;
  const unit =
    activity.type === 'transport' || activity.pricingMode === 'vehicle'
      ? t('per vehicle')
      : activity.pricingMode === 'per_group'
        ? // Always read as a group price; only append "up to N" when the size is known. Falling back
          // to "per person" for a per_group tour (missing maxGuests) misrepresents the price.
          groupSize && groupSize > 1
          ? t('per group up to {n}', { n: groupSize })
          : t('per group')
        : t('per person');
  const duration = durationLabel(activity.durationMinutes, t);
  const meta = [duration, activity.type === 'transport' ? t('Private transfer') : t('Pickup available')]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-ink/[0.08] bg-white text-left shadow-[0_1px_3px_rgba(10,46,54,0.06)] transition-shadow duration-300 hover:shadow-[0_18px_38px_-16px_rgba(10,46,54,0.4)] ${
        rail ? `${compact ? 'w-[228px]' : 'w-[300px]'} shrink-0` : ''
      } ${className}`}
    >
      <div className={`relative overflow-hidden ${compact ? 'aspect-[16/10]' : 'aspect-[4/3]'}`}>
        {/* Only the image scales on hover — the card and text never move. */}
        {image ? (
          <img
            src={image.url}
            alt={image.alt ?? activity.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)] transition-transform duration-500 ease-out group-hover:scale-105">
            <span className="font-display text-3xl font-semibold text-white/90">
              {activity.title.slice(0, 1)}
            </span>
          </div>
        )}

        <span className="absolute left-3 top-3 z-10 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-teal-dark backdrop-blur">
          {activity.category}
        </span>
        {topRated && (
          <span className="absolute left-3 top-11 z-10 rounded-md bg-ink px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
            {t('Top rated')}
          </span>
        )}
        <WishHeart slug={activity.slug} className="absolute right-3 top-3 z-10 h-8 w-8 shadow-sm" />
      </div>

      <div className={`flex flex-1 flex-col ${compact ? 'px-3.5 pb-3 pt-2.5' : 'px-4 pb-4 pt-3'}`}>
        {activity.location && (
          <div className="text-[12px] font-bold uppercase tracking-wide text-teal">
            {activity.location}
          </div>
        )}
        <TitleTag
          className={`mt-1 line-clamp-2 font-bold leading-snug text-ink ${
            compact ? 'text-[14px]' : 'min-h-[44px] text-[15px]'
          }`}
        >
          {activity.title}
        </TitleTag>
        {meta && !compact && <div className="mt-1.5 text-[12.5px] text-ink-muted">{meta}</div>}
        {activity.minAdvanceDays > 1 && !compact && (
          <span className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-md bg-teal/10 px-1.5 py-0.5 text-[11px] font-bold text-teal-dark">
            <IconCalendar width={11} height={11} /> {t('Book {n}+ days ahead', { n: activity.minAdvanceDays })}
          </span>
        )}

        <div className={`mt-auto flex items-end justify-between ${compact ? 'pt-2' : 'pt-3'}`}>
          {activity.ratingCount > 0 ? (
            <span className="flex items-center gap-1 text-[13px] text-ink">
              <IconStar width={14} height={14} className="text-gold-light" />
              <b>{activity.ratingAvg?.toFixed(1)}</b>
              <span className="font-medium text-ink-muted">({activity.ratingCount})</span>
            </span>
          ) : (
            <span className="rounded bg-teal/10 px-1.5 py-0.5 text-[11px] font-bold text-teal">
              {t('New activity')}
            </span>
          )}
          <span className="text-right text-[12.5px] text-ink-muted">
            {activity.fromPriceEur != null ? (
              <>
                {t('From')} <Price eur={activity.fromPriceEur} className="text-[18px] font-bold text-ink" />
                <span className="block text-[11px] leading-tight">{unit}</span>
              </>
            ) : (
              <b className="text-ink">{t('On request')}</b>
            )}
          </span>
        </div>
      </div>

      {/* Stretched link to detail — above the content, below the heart control. */}
      <Link href={`/activities/${activity.slug}`} aria-label={activity.title} className="absolute inset-0 z-0" />
    </div>
  );
}
