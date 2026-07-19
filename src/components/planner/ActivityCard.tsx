'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { BmtActivity } from '@/lib/planner/our-activities';
import { fmtDur } from './planner-constants';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';

/** "Sep 3" style short label from a day key, for the card CTA. */
function shortDate(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? dayKey
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The branded Belle Mare Tours recommendation card: a real catalogue activity anchored to a trip
 * date, availability-checked server-side. Used in the chat, the day panel and the map's marker
 * pop-over; the CTA deep-links to the activity page with the date preselected, where the normal
 * booking flow (and its zero-trust pricing) takes over.
 */
export function ActivityCard({
  activity,
  date,
  seatsLeft,
  onRemove,
  compact = false,
}: {
  activity: BmtActivity;
  /** The trip date this recommendation is for (drives the CTA + the ?date= deep-link). */
  date: string;
  /** Real seats left on that date, when known (from the availability check). */
  seatsLeft?: number;
  /** Un-anchor the activity from the day (shown only in the day panel). */
  onRemove?: () => void;
  /** Tighter paddings for the map pop-over. */
  compact?: boolean;
}) {
  const t = useT();
  const [broken, setBroken] = useState(false);
  const img = activity.heroImageUrl && !broken ? activity.heroImageUrl : null;
  return (
    <div
      className={`overflow-hidden rounded-[14px] border border-[#F8D3CE] bg-white shadow-[0_8px_22px_rgba(247,108,94,.14)] ${compact ? '' : 'animate-float-in'}`}
    >
      <div className="flex items-center gap-2 bg-gradient-to-r from-[#FDECEA] to-white px-3 py-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand icon */}
        <img src="/icon.svg" alt="" width={14} height={14} className="rounded-[4px]" />
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.05em] text-coral">
          {t('Belle Mare Tours activity · {date}', { date: shortDate(date) })}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('Remove {name}', { name: activity.title })}
            className="ml-auto grid h-6 w-6 cursor-pointer place-items-center rounded-md text-[#B7C6C8] hover:bg-[#FDECEA] hover:text-coral"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      <div className={`flex gap-[11px] ${compact ? 'p-2.5' : 'p-3'}`}>
        <div
          className="relative grid h-[58px] w-[58px] shrink-0 place-items-center overflow-hidden rounded-xl"
          style={{ background: 'linear-gradient(150deg,#F76C5E,#C94A3E)' }}
          aria-hidden
        >
          <span className="font-display text-[24px] font-semibold text-white/90">
            {activity.title[0]}
          </span>
          {img && (
            // eslint-disable-next-line @next/next/no-img-element -- dynamic catalogue photo; small thumb
            <img
              src={img}
              alt=""
              loading="lazy"
              onError={() => setBroken(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold text-ink">{activity.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-ink-muted">
            {activity.ratingAvg != null && (
              <span className="inline-flex items-center gap-1 font-bold text-ink">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="#C98A12" aria-hidden>
                  <path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 16.9 5.9 20.4l1.5-6.8L2.2 9l6.9-.7L12 2Z" />
                </svg>
                {activity.ratingAvg.toFixed(1)}
                <span className="font-medium text-ink-muted">({activity.ratingCount})</span>
              </span>
            )}
            {activity.durationMinutes != null && <span>{fmtDur(activity.durationMinutes)}</span>}
            {seatsLeft != null && seatsLeft <= 5 && (
              <span className="font-bold text-coral">{t('Only {n} left', { n: seatsLeft })}</span>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[12.5px] text-ink-muted">
              {activity.fromPriceEur != null ? (
                <>
                  {t('From')}{' '}
                  <strong className="text-[14px] text-ink">
                    <Price eur={activity.fromPriceEur} />
                  </strong>
                </>
              ) : null}
            </span>
            <Link
              href={`/activities/${activity.slug}?date=${date}`}
              className="shrink-0 rounded-[9px] bg-coral px-3 py-[7px] text-[12px] font-extrabold text-white shadow-[0_4px_12px_rgba(247,108,94,.3)] hover:brightness-105"
            >
              {t('View & book for {date} →', { date: shortDate(date) })}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
