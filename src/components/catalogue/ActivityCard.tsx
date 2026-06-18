'use client';

import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { durationLabel } from '@/lib/catalogue/detail';
import { IconPin, IconStar } from '@/components/ui/icons';
import { WishHeart } from '@/components/gyg/WishHeart';
import { Price } from '@/components/site/Price';
import { useT } from '@/components/site/PreferencesProvider';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

export function ActivityCard({ activity }: { activity: TourSummary }) {
  const t = useT();
  const duration = durationLabel(activity.durationMinutes);
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-card border border-ink/[0.08] bg-white shadow-sm transition-shadow duration-300 hover:shadow-[0_18px_38px_-16px_rgba(10,46,54,0.4)]">
      <div className="relative aspect-[4/3] overflow-hidden">
        {activity.heroImage ? (
          <img
            src={activity.heroImage.url}
            alt={activity.heroImage.alt ?? activity.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)] transition duration-500 group-hover:scale-105">
            <span className="font-display text-2xl font-medium text-white/90">
              {activity.title.slice(0, 1)}
            </span>
          </div>
        )}
        <span className="absolute left-3 top-3 z-10 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-teal-dark backdrop-blur">
          {activity.category}
        </span>
        <WishHeart slug={activity.slug} className="absolute right-3 top-3 z-10 h-8 w-8 shadow-sm" />
      </div>

      <div className="flex flex-1 flex-col p-4">
        {activity.location && (
          <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-teal">
            <IconPin width={13} height={13} />
            {activity.location}
          </div>
        )}
        <h3 className="m-0 line-clamp-2 text-base font-bold leading-snug text-ink">
          {activity.title}
        </h3>
        {duration && <div className="mt-2 text-[13px] text-ink-muted">{duration}</div>}

        <div className="mt-auto flex items-center justify-between border-t border-ink/[0.07] pt-3.5">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <IconStar width={15} height={15} className="text-gold-light" />
            <b>{activity.ratingAvg?.toFixed(1) ?? '—'}</b>
            <span className="font-medium text-ink-muted">({activity.ratingCount})</span>
          </span>
          <span className="text-[13px] text-ink-muted">
            {activity.fromPriceEur != null ? (
              <>
                {t('from')} <Price eur={activity.fromPriceEur} className="text-[19px] font-bold text-ink" />
              </>
            ) : (
              <b className="text-ink">{t('On request')}</b>
            )}
          </span>
        </div>
      </div>

      {/* Stretched link to detail — below the heart + category chip so they stay clickable. */}
      <Link
        href={`/activities/${activity.slug}`}
        aria-label={activity.title}
        className="absolute inset-0 z-0"
      />
    </div>
  );
}
