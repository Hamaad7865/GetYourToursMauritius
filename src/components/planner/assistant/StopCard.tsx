'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { StopNote } from '@/lib/planner/chat-history';
import type { BmtActivity } from '@/lib/planner/our-activities';
import { localePath } from '@/lib/i18n/routing';
import { usePreferences } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { IconExternalLink, IconHeart, IconX } from '@/components/ui/icons';
import { fmtDur, hueFor, thumbGradient } from '../planner-constants';
import { StarRating } from './StarRating';
import { stopCardId } from './focus-stop';
import { IconArrowDown, IconArrowUp } from './icons';

/** A place's photo over its category-hued gradient, which shows while loading and if it fails. */
export function StopPhoto({
  place,
  src,
  className,
}: {
  place: { id: string; name: string; category: string };
  src: string | null | undefined;
  className: string;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: thumbGradient(hueFor(place)) }}
    >
      {/* No photo (a curated preset stop, or one that failed to load): the place's initial on its
          category colour, the same stand-in the small thumbnails use — not an empty block. */}
      <span
        aria-hidden
        className="absolute inset-0 grid place-items-center text-[64px] font-extrabold leading-none text-white/85"
      >
        {place.name[0]}
      </span>
      {src && !broken && (
        // eslint-disable-next-line @next/next/no-img-element -- Google photo through our own proxy; sizes vary per place
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

const iconButton =
  'grid h-10 w-10 cursor-pointer place-items-center rounded-full text-ink-muted transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent';

/**
 * One stop of the day, as a result card: its photo, Google's rating, what ZilAi says it is like, and
 * the one line on when it is at its best — highlighted, because that is the line a visitor acts on.
 *
 * The heart keeps a stop through "Regenerate unpinned". It is not a wishlist: it only means "this
 * one stays".
 */
export function StopCard({
  place,
  index,
  count,
  note,
  pinned,
  busy,
  onTogglePin,
  onRemove,
  onMove,
}: {
  place: PlannerPlace;
  /** Position in the day, 0-based. */
  index: number;
  count: number;
  note: StopNote | undefined;
  pinned: boolean;
  /** ZilAi is changing the plan — editing controls wait. */
  busy: boolean;
  onTogglePin: () => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState(false);
  const why = note?.why ?? place.blurb;
  const hasRating =
    typeof place.rating === 'number' &&
    typeof place.ratingCount === 'number' &&
    place.ratingCount > 0;
  const extraPhotos = (place.imageUrls ?? []).slice(1);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.id)}`;
  const detailsId = `${stopCardId(place.id)}-details`;

  return (
    <li
      id={stopCardId(place.id)}
      className="zilai-card zilai-stop relative scroll-mt-4 pl-[52px]"
      style={{ '--i': index } as React.CSSProperties}
    >
      <span
        aria-hidden
        className="zilai-node absolute left-[9px] top-5 grid h-8 w-8 place-items-center rounded-full bg-teal-dark text-[14px] font-extrabold tabular-nums text-white ring-4 ring-white"
        style={{ '--i': index } as React.CSSProperties}
      >
        {index + 1}
      </span>

      <article className="zilai-stop-body flex gap-4 rounded-2xl border border-ink/[0.14] bg-white p-3.5 transition-[border-color,box-shadow] duration-300">
        <div className="relative shrink-0">
          <StopPhoto place={place} src={place.imageUrl} className="zilai-stop-photo rounded-xl" />
          <button
            type="button"
            onClick={onTogglePin}
            aria-pressed={pinned}
            aria-label={
              pinned
                ? t('Stop keeping {name}', { name: place.name })
                : t('Keep {name} when the plan is regenerated', { name: place.name })
            }
            title={pinned ? t('Kept — stays when you regenerate') : t('Keep this stop')}
            className={`zilai-heart absolute right-2 top-2 grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-white shadow-[0_2px_10px_rgba(10,46,54,0.22)] transition-colors ${
              pinned ? 'text-coral-dark' : 'text-ink hover:text-coral-dark'
            }`}
          >
            <IconHeart width={19} height={19} fill={pinned ? 'currentColor' : 'none'} />
          </button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="m-0 text-[18px] font-extrabold leading-snug tracking-[-0.01em] text-ink">
            <span className="tabular-nums">{index + 1}. </span>
            {place.name}
          </h3>
          {hasRating && (
            <div className="mt-1">
              <StarRating rating={place.rating!} count={place.ratingCount!} source="google" />
            </div>
          )}
          <p className="m-0 mt-1 text-[13px] text-ink-muted">
            {[
              t(place.category),
              t(place.region),
              t('{d} here', { d: fmtDur(place.durationMin) }),
              place.closesAt ? t('closes {time}', { time: place.closesAt }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          {(why || note?.tip) && (
            <p className="m-0 mt-2.5 max-w-[62ch] text-[15px] leading-[1.55] text-ink">
              {why}
              {why && note?.tip ? ' ' : ''}
              {note?.tip && (
                <span
                  className="zilai-mark font-semibold"
                  style={{ '--i': index } as React.CSSProperties}
                >
                  {note.tip}
                </span>
              )}
            </p>
          )}

          {expanded && (
            <div id={detailsId} className="zilai-view mt-3">
              {extraPhotos.length > 0 && (
                <div className="flex gap-2">
                  {extraPhotos.map((src) => (
                    <StopPhoto
                      key={src}
                      place={place}
                      src={src}
                      className="h-[92px] flex-1 rounded-lg"
                    />
                  ))}
                </div>
              )}
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-teal-dark underline decoration-teal/40 underline-offset-[3px] hover:decoration-teal"
              >
                {t('Open in Google Maps')}
                <IconExternalLink width={14} height={14} />
              </a>
            </div>
          )}

          <div className="mt-auto flex items-center gap-1 pt-3">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls={detailsId}
              className="cursor-pointer rounded-full border border-ink/70 px-4 py-2 text-[14px] font-bold text-ink transition-colors hover:bg-ink hover:text-white"
            >
              {expanded ? t('Hide details') : t('See details')}
            </button>
            <span className="ml-auto flex items-center">
              <button
                type="button"
                onClick={() => onMove(index - 1)}
                disabled={busy || index === 0}
                aria-label={t('Move {name} earlier', { name: place.name })}
                className={iconButton}
              >
                <IconArrowUp width={17} height={17} />
              </button>
              <button
                type="button"
                onClick={() => onMove(index + 1)}
                disabled={busy || index === count - 1}
                aria-label={t('Move {name} later', { name: place.name })}
                className={iconButton}
              >
                <IconArrowDown width={17} height={17} />
              </button>
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                aria-label={t('Remove {name} from the day', { name: place.name })}
                className={`${iconButton} hover:!bg-coral/10 hover:!text-coral-dark`}
              >
                <IconX width={17} height={17} />
              </button>
            </span>
          </div>
        </div>
      </article>
    </li>
  );
}

/**
 * One of OUR tours on a trip day. Same shape as a stop card so the day reads as one list, but it
 * carries what only we can show: our own guests' rating, a real price, real seats — and it books.
 */
export function TourCard({
  activity,
  date,
  seatsLeft,
  onRemove,
}: {
  activity: BmtActivity;
  date: string;
  seatsLeft: number | null | undefined;
  onRemove?: () => void;
}) {
  const { t, language } = usePreferences();
  const href = localePath(language, `/activities/${activity.slug}?date=${date}`);
  return (
    <article className="zilai-card zilai-stop-body flex gap-4 rounded-2xl bg-teal-tint p-3.5">
      <div className="relative shrink-0">
        <StopPhoto
          place={{ id: activity.slug, name: activity.title, category: activity.category }}
          src={activity.heroImageUrl}
          className="zilai-stop-photo rounded-xl"
        />
        <span className="absolute left-2 top-2 rounded-full bg-white px-2.5 py-1 text-[12px] font-extrabold text-teal-dark shadow-[0_2px_8px_rgba(10,46,54,0.18)]">
          {t('Our tour')}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="m-0 text-[18px] font-extrabold leading-snug tracking-[-0.01em] text-ink">
          {activity.title}
        </h3>
        {activity.ratingAvg != null && activity.ratingCount > 0 && (
          <div className="mt-1">
            <StarRating rating={activity.ratingAvg} count={activity.ratingCount} source="guests" />
          </div>
        )}
        <p className="m-0 mt-1 text-[13px] text-ink-muted">
          {[
            activity.category,
            activity.durationMinutes ? fmtDur(activity.durationMinutes) : null,
            typeof seatsLeft === 'number'
              ? t('{n} seats left on this date', { n: seatsLeft })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {activity.summary && (
          <p className="m-0 mt-2.5 line-clamp-3 max-w-[62ch] text-[15px] leading-[1.55] text-ink">
            {activity.summary}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-3 pt-3">
          <Link
            href={href}
            className="rounded-full bg-teal-dark px-4 py-2 text-[14px] font-bold text-white transition-colors hover:bg-ink"
          >
            {t('View & book')}
          </Link>
          {activity.fromPriceEur != null && (
            <span className="text-[14px] text-ink">
              {t('from')}{' '}
              <strong className="text-[16px] tabular-nums">
                <Price eur={activity.fromPriceEur} />
              </strong>{' '}
              {activity.pricingMode === 'per_person' ? t('per person') : ''}
            </span>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={t('Remove {name} from the day', { name: activity.title })}
              className={`${iconButton} ml-auto`}
            >
              <IconX width={17} height={17} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
