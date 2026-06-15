'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { WishHeart } from './WishHeart';
import { IconChevronLeft, IconChevronRight, IconStar } from '@/components/ui/icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

function durationLabel(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  const rounded = Number.isInteger(h) ? h : Math.round(h * 10) / 10;
  return `${rounded} hour${rounded === 1 ? '' : 's'}`;
}

/**
 * Activity card, recoloured to the Belle Mare brand. The card and its text are deliberately
 * STATIC — the only hover effect is a gentle zoom on the photo itself. When an activity has
 * several photos they become a click-through carousel (arrows + dots); the image slide is
 * the only thing that moves. The whole card is a stretched link to the detail page, with the
 * carousel/heart controls layered above it.
 */
export function PlaceCard({
  activity,
  rail = false,
  className = '',
}: {
  activity: TourSummary;
  rail?: boolean;
  className?: string;
}) {
  // Prefer the full photo array (for the carousel); degrade to the hero image alone when
  // the search result predates the images-array migration, so a card is never imageless.
  const images =
    activity.images.length > 0 ? activity.images : activity.heroImage ? [activity.heroImage] : [];
  const [index, setIndex] = useState(0);

  function go(dir: 1 | -1, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (images.length === 0) return;
    setIndex((i) => (i + dir + images.length) % images.length);
  }

  const topRated = activity.ratingAvg != null && activity.ratingAvg >= 4.7;
  const unit = activity.type === 'transport' ? 'per vehicle' : 'per person';
  const duration = durationLabel(activity.durationMinutes);
  const meta = [duration, activity.type === 'transport' ? 'Private transfer' : 'Pickup available']
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-ink/[0.08] bg-white shadow-[0_1px_3px_rgba(10,46,54,0.06)] ${
        rail ? 'w-[300px] shrink-0' : ''
      } ${className}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        {/* Zoom layer: only the image scales on hover — the card and text never move. */}
        {images.length > 0 ? (
          <div className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-105">
            <div
              className="flex h-full w-full transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${index * 100}%)` }}
            >
              {images.map((img) => (
                <img
                  key={img.id}
                  src={img.url}
                  alt={img.alt ?? activity.title}
                  loading="lazy"
                  className="h-full w-full shrink-0 object-cover"
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)] transition-transform duration-500 ease-out group-hover:scale-105">
            <span className="font-display text-3xl font-semibold text-white/90">
              {activity.title.slice(0, 1)}
            </span>
          </div>
        )}

        {images.length > 1 && (
          <div className="absolute inset-0 z-10 flex items-center justify-between p-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={(e) => go(-1, e)}
              aria-label="Previous photo"
              className="grid h-8 w-8 place-items-center rounded-full bg-black/35 text-white transition-colors hover:bg-black/55"
            >
              <IconChevronLeft width={18} height={18} />
            </button>
            <button
              type="button"
              onClick={(e) => go(1, e)}
              aria-label="Next photo"
              className="grid h-8 w-8 place-items-center rounded-full bg-black/35 text-white transition-colors hover:bg-black/55"
            >
              <IconChevronRight width={18} height={18} />
            </button>
          </div>
        )}

        <span className="absolute left-3 top-3 z-10 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-teal-dark backdrop-blur">
          {activity.category}
        </span>
        {topRated && (
          <span className="absolute left-3 top-11 z-10 rounded-md bg-ink px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
            Top rated
          </span>
        )}
        <WishHeart slug={activity.slug} className="absolute right-3 top-3 z-10 h-8 w-8 shadow-sm" />

        {images.length > 1 && (
          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIndex(i);
                }}
                aria-label={`Show photo ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/60'}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
        {activity.location && (
          <div className="text-[12px] font-bold uppercase tracking-wide text-teal">
            {activity.location}
          </div>
        )}
        <h3 className="mt-1 line-clamp-2 min-h-[44px] text-[15px] font-bold leading-snug text-ink">
          {activity.title}
        </h3>
        {meta && <div className="mt-1.5 text-[12.5px] text-ink-muted">{meta}</div>}

        <div className="mt-auto flex items-end justify-between pt-3">
          {activity.ratingCount > 0 ? (
            <span className="flex items-center gap-1 text-[13px] text-ink">
              <IconStar width={14} height={14} className="text-gold-light" />
              <b>{activity.ratingAvg?.toFixed(1)}</b>
              <span className="font-medium text-ink-muted">({activity.ratingCount})</span>
            </span>
          ) : (
            <span className="rounded bg-teal/10 px-1.5 py-0.5 text-[11px] font-bold text-teal">
              New activity
            </span>
          )}
          <span className="text-right text-[12.5px] text-ink-muted">
            {activity.fromPriceEur != null ? (
              <>
                From <b className="text-[18px] text-ink">€{activity.fromPriceEur}</b>
                <span className="block text-[11px] leading-tight">{unit}</span>
              </>
            ) : (
              <b className="text-ink">On request</b>
            )}
          </span>
        </div>
      </div>

      {/* Stretched link to detail — above the content, below the carousel/heart controls. */}
      <Link href={`/activities/${activity.slug}`} aria-label={activity.title} className="absolute inset-0 z-0" />
    </div>
  );
}
