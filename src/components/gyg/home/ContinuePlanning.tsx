'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { activityRating } from '@/lib/content/activity-reviews';
import { dropExpiredHolds } from '@/lib/cart/cart-holds';
import type { CartItem } from '@/lib/cart/useCart';
import { RECENT_VIEWS_EVENT, clearRecentViews, readRecentViews } from '@/lib/recent/views';
import { IconCart, IconStar } from '@/components/ui/icons';
import { useHomeActivities } from '../HomeShowcaseContext';
import { durationLabel, priceUnit } from '@/lib/catalogue/price-unit';
import { Rail } from '../Rail';
import { WishHeart } from '../WishHeart';
import { CART_KEY, CONTINUE_SECTION_ID, WISHLIST_KEY } from './ContinuePlanningReserve';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

const MAX_CARDS = 10;

interface Snapshot {
  recent: string[];
  wished: string[];
  /** slug → the date the visitor picked for the line that is in their cart. */
  cart: Map<string, string>;
}

function readList(key: string): unknown[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readSnapshot(): Snapshot {
  // Same view the cart itself shows: a line whose seat hold has lapsed is no longer "in your cart".
  const lines = dropExpiredHolds(readList(CART_KEY) as CartItem[], Date.now()).kept;
  const cart = new Map<string, string>();
  for (const line of lines) {
    if (line && typeof line.slug === 'string' && !cart.has(line.slug)) {
      cart.set(line.slug, typeof line.dateLabel === 'string' ? line.dateLabel : '');
    }
  }
  return {
    recent: readRecentViews(),
    wished: readList(WISHLIST_KEY).filter((s): s is string => typeof s === 'string'),
    cart,
  };
}

/**
 * "Continue planning your trip" — the homepage's returning-visitor state.
 *
 * GetYourGuide resurfaces what you looked at. This resurfaces everything a visitor has started with
 * us, in the order they are closest to booking it: what is already in their cart (with the date they
 * chose), then what they viewed, then what they saved. All of it is read from this browser's own
 * storage — the homepage is edge-cached and identical for everyone, so the server never knows.
 *
 * First-time visitors get nothing here at all: the section stays `display:none` and the place tiles
 * below it are the first thing under the hero.
 */
export function ContinuePlanning() {
  const t = useT();
  const activities = useHomeActivities();
  const ref = useRef<HTMLElement>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  // Layout effect, not effect: on a client-side navigation back to the homepage the inline script
  // does not run, so this is what keeps the rail from appearing one frame late.
  useLayoutEffect(() => {
    setSnap(readSnapshot());
    // From here React owns visibility; the pre-paint attribute has done its job.
    ref.current?.removeAttribute('data-on');
  }, []);

  useEffect(() => {
    const sync = () => setSnap(readSnapshot());
    const events = [RECENT_VIEWS_EVENT, WISHLIST_KEY, CART_KEY, 'storage'];
    for (const e of events) window.addEventListener(e, sync);
    return () => {
      for (const e of events) window.removeEventListener(e, sync);
    };
  }, []);

  const pending = snap === null;
  const entries: { activity: TourSummary; cartDate: string | null }[] = [];
  if (snap) {
    const bySlug = new Map(activities.map((a) => [a.slug, a]));
    const seen = new Set<string>();
    for (const slug of [...snap.cart.keys(), ...snap.recent, ...snap.wished]) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      // A slug that has left the catalogue (unpublished, renamed) simply drops out.
      const activity = bySlug.get(slug);
      if (activity) entries.push({ activity, cartDate: snap.cart.get(slug) ?? null });
      if (entries.length === MAX_CARDS) break;
    }
  }

  // Before the browser's storage has been read the section is hidden unless the pre-paint script
  // flagged it; after, it shows exactly when there is something to show.
  const visibility = pending
    ? "hidden data-[on='1']:block"
    : entries.length > 0
      ? 'block'
      : 'hidden';

  return (
    <section
      id={CONTINUE_SECTION_ID}
      ref={ref}
      // The pre-paint script sets data-on before React hydrates; that attribute is expected to differ.
      suppressHydrationWarning
      aria-labelledby="continue-planning-heading"
      className={`mx-auto max-w-shell px-6 pt-2 ${visibility}`}
    >
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2
          id="continue-planning-heading"
          className="text-[clamp(21px,2.3vw,26px)] font-extrabold tracking-[-0.02em] text-ink"
        >
          {t('Continue planning your trip')}
        </h2>
        {snap && snap.recent.length > 0 && (
          <button
            type="button"
            onClick={clearRecentViews}
            aria-label={t('Clear viewed')}
            className="shrink-0 rounded-md text-[13.5px] font-semibold text-ink-muted underline decoration-ink/25 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
          >
            {/* The full label would push the heading onto two lines on a phone. */}
            <span className="sm:hidden">{t('Clear')}</span>
            <span className="max-sm:hidden">{t('Clear viewed')}</span>
          </button>
        )}
      </div>

      <Rail bleed arrowTop="top-[calc(50%-4px)]" ariaLabel={t('Continue planning your trip')}>
        {pending
          ? [0, 1, 2].map((i) => <CardSkeleton key={i} />)
          : entries.map((e) => (
              <ContinueCard key={e.activity.id} activity={e.activity} cartDate={e.cartDate} />
            ))}
      </Rail>
    </section>
  );
}

// Widths: one card and a peek of the next on a phone, then exactly two and exactly three across
// (the track's gap-5 is 1.25rem), so no card is ever cut off mid-photo at the page edge.
const CARD_SHELL =
  'relative flex h-[150px] w-[min(86vw,384px)] shrink-0 snap-start gap-3.5 rounded-2xl border border-ink/[0.12] bg-white p-3 md:w-[calc((100%-1.25rem)/2)] lg:w-[calc((100%-2.5rem)/3)]';

function CardSkeleton() {
  return (
    <div aria-hidden className={CARD_SHELL}>
      <div className="h-[126px] w-[126px] shrink-0 rounded-xl bg-ink/[0.06]" />
      <div className="flex flex-1 flex-col gap-2.5 py-1.5">
        <div className="h-4 w-11/12 rounded bg-ink/[0.06]" />
        <div className="h-4 w-7/12 rounded bg-ink/[0.06]" />
        <div className="mt-auto h-4 w-5/12 rounded bg-ink/[0.06]" />
      </div>
    </div>
  );
}

/** GetYourGuide's compact "continue" card: square photo left, the facts stacked right. */
function ContinueCard({ activity, cartDate }: { activity: TourSummary; cartDate: string | null }) {
  const t = useT();
  const image = activity.heroImage ?? activity.images[0] ?? null;
  const rating = activityRating(activity);
  const meta = [durationLabel(activity.durationMinutes, t), t(activity.category)]
    .filter(Boolean)
    .join(' · ');

  return (
    <article
      className={`group ${CARD_SHELL} text-left transition-shadow duration-300 hover:shadow-[0_14px_30px_-16px_rgba(10,46,54,0.45)]`}
    >
      <div className="relative h-[126px] w-[126px] shrink-0 overflow-hidden rounded-xl bg-teal-tint">
        {image ? (
          <img
            src={image.url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-teal-dark text-2xl font-extrabold text-white">
            {activity.title.slice(0, 1)}
          </div>
        )}
        <WishHeart
          slug={activity.slug}
          size={16}
          className="absolute right-1.5 top-1.5 z-10 h-8 w-8 shadow-sm"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col py-0.5">
        <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-ink">
          {activity.title}
        </h3>
        {cartDate !== null ? (
          <Link
            href="/cart"
            className="relative z-10 mt-1.5 inline-flex w-fit max-w-full items-center gap-1.5 rounded-md bg-teal-tint px-2 py-1 text-[12px] font-bold text-teal-dark hover:bg-teal/20"
          >
            <IconCart width={13} height={13} className="shrink-0" />
            <span className="truncate">
              {cartDate ? t('In your cart · {date}', { date: cartDate }) : t('In your cart')}
            </span>
          </Link>
        ) : (
          meta && <p className="mt-1 truncate text-[12.5px] text-ink-muted">{meta}</p>
        )}

        <div className="mt-auto flex items-end justify-between gap-2">
          <span className="flex shrink-0 items-center gap-1 text-[13px] text-ink">
            <b>{rating.avg.toFixed(1)}</b>
            <IconStar width={13} height={13} className="text-gold-light" />
            <span className="text-ink-muted">({rating.count})</span>
          </span>
          <span className="min-w-0 text-right text-[12px] leading-tight text-ink-muted">
            {activity.fromPriceEur != null ? (
              <>
                {t('From')}{' '}
                <Price
                  eur={activity.fromPriceEur}
                  className="text-[17px] font-extrabold text-ink"
                />
                <span className="block truncate text-[11px]">{priceUnit(activity, t)}</span>
              </>
            ) : (
              <b className="text-ink">{t('On request')}</b>
            )}
          </span>
        </div>
      </div>

      {/* Stretched link to the tour — above the card, below the heart and the cart chip. */}
      <Link
        href={`/activities/${activity.slug}`}
        aria-label={activity.title}
        className="absolute inset-0 z-0 rounded-2xl"
      />
    </article>
  );
}
