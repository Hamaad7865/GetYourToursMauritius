'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from '@/components/site/LocaleLink';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { categoryHref } from '@/lib/catalogue/category-hubs';
import { homeTile, type HomeTour } from '@/lib/catalogue/home-tours';
import {
  chooseHomeRow,
  homeRowHeading,
  isHomePicks,
  mauritiusTomorrow,
  type HomeRowVariant,
} from '@/lib/catalogue/home-row';
import { pushDataLayerEvent } from '@/lib/consent/gtag';
import { HOME_TILE } from '@/lib/images/presets';
import { responsiveImage } from '@/lib/images/resize';
import { INTEREST_EVENT, clearInterest, readInterest } from '@/lib/recent/interest';
import { readOnIsland, writeOnIsland } from '@/lib/recent/on-island';
import { RECENT_VIEWS_EVENT } from '@/lib/recent/views';
import type { HomePicks } from '@/lib/validation/home-picks';
import { useHomeActivities } from '../HomeShowcaseContext';
import { readContinuingSlugs } from './ContinuePlanning';
import { HOME_TOURS_ID } from './HomeToursReserve';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** Tiles are drawn at up to ~190 CSS px; these only reserve the square before the photo arrives. */
const TILE_SIZE = 500;
/** Past this the row stays as it is: a slow answer must not swap tiles long after reading started. */
const FETCH_BUDGET_MS = 1500;

interface Shown {
  variant: HomeRowVariant;
  slugs: string[];
}

async function getData(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  const body = (await res.json()) as { ok?: boolean; data?: unknown } | null;
  return body?.ok ? body.data : null;
}

/**
 * The homepage's first row, under the hero. The server renders "Most booked by our guests" (or today's
 * private tours) — the same HTML for everyone, which is what Google sees. In the browser, chooseHomeRow
 * may swap the tiles for the guides this visitor read or, if they are in Mauritius, the tours still free
 * tomorrow.
 *
 * FOOTPRINT: a swap must never move the page. Every tile reserves two title lines and always has a price
 * line ("On request" when there is no price); on phones the heading always reserves two lines; on a
 * tablet the grid always reserves its two rows, however few tiles it holds; and a row the pre-paint
 * script marked shows same-size placeholders instead of tiles until the client has chosen.
 */
export function HomeToursRow({
  serverVariant,
  serverSlugs,
  serverPicks,
}: {
  serverVariant: HomeRowVariant;
  serverSlugs: string[];
  serverPicks: HomePicks | null;
}) {
  const t = useT();
  const activities = useHomeActivities();
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState<Shown>({ variant: serverVariant, slugs: serverSlugs });
  // What the last decision knew, so a re-decision (Clear, a guide read in another tab) reuses it.
  const known = useRef<{ picks: HomePicks | null; onIsland: boolean; variant: HomeRowVariant }>({
    picks: serverPicks,
    onIsland: false,
    variant: serverVariant,
  });

  const decide = useCallback(() => {
    const row = chooseHomeRow({
      activities,
      picks: known.current.picks,
      tomorrow: mauritiusTomorrow(new Date()),
      interest: readInterest(),
      continuing: readContinuingSlugs(),
      onIsland: known.current.onIsland,
    });
    // Never swap to nothing: an empty answer keeps the tiles already on screen.
    if (row.tiles.length === 0) return;
    known.current.variant = row.variant;
    const slugs = row.tiles.map((x) => x.tour.slug);
    setShown((prev) =>
      prev.variant === row.variant && prev.slugs.join() === slugs.join()
        ? prev
        : { variant: row.variant, slugs },
    );
  }, [activities]);

  // Storage alone: a guide reader, or a visit already known to be in Mauritius, gets their row at
  // hydration — behind the placeholders the pre-paint script put up — with no network wait.
  useLayoutEffect(() => {
    known.current.onIsland = readOnIsland() === true;
    decide();
    ref.current?.removeAttribute('data-personal');
  }, [decide]);

  // Then the network: where they are browsing from, and fresh picks. Each answer stands on its own, so
  // a slow picks read cannot cost an on-island visitor the row the server's picks can already fill.
  useEffect(() => {
    let live = true;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), FETCH_BUDGET_MS);
    const as = new URLSearchParams(window.location.search).get('as');
    const localityUrl = `/api/planner/locality${as ? `?as=${encodeURIComponent(as)}` : ''}`;
    void Promise.allSettled([
      getData(localityUrl, ctrl.signal),
      getData('/api/v1/activities/picks', ctrl.signal),
    ]).then(([locality, picks]) => {
      window.clearTimeout(timer);
      if (!live) return;
      const place =
        locality.status === 'fulfilled' ? (locality.value as { onIsland?: unknown } | null) : null;
      if (place) {
        const onIsland = place.onIsland === true;
        writeOnIsland(onIsland);
        known.current.onIsland = onIsland;
      }
      if (picks.status === 'fulfilled' && isHomePicks(picks.value)) {
        known.current.picks = picks.value;
      }
      decide();
      pushDataLayerEvent({ event: 'home_row', home_row: known.current.variant });
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [decide]);

  // A guide read (or "Clear") in this tab or another re-decides.
  useEffect(() => {
    const events = [INTEREST_EVENT, RECENT_VIEWS_EVENT, 'storage'];
    for (const e of events) window.addEventListener(e, decide);
    return () => {
      for (const e of events) window.removeEventListener(e, decide);
    };
  }, [decide]);

  const bySlug = new Map(activities.map((a) => [a.slug, a]));
  const tiles = shown.slugs
    .map((slug) => {
      const tour = bySlug.get(slug);
      return tour ? homeTile(tour) : null;
    })
    .filter((x): x is HomeTour => x !== null);
  if (tiles.length === 0) return null;
  const seeAll =
    shown.variant === 'private' ? categoryHref(tiles[0]!.tour.category) : '/activities';

  return (
    <section
      id={HOME_TOURS_ID}
      ref={ref}
      // The pre-paint script sets data-personal before React hydrates; that attribute is expected to differ.
      suppressHydrationWarning
      aria-labelledby="tours-heading"
      className="mx-auto max-w-shell px-6 pt-10 sm:pt-12"
    >
      <div className="flex items-end justify-between gap-4">
        <h2
          id="tours-heading"
          className="flex min-h-[3em] items-end text-[clamp(21px,2.3vw,26px)] font-extrabold tracking-[-0.02em] text-ink [[data-personal=on]_&]:invisible md:min-h-0"
        >
          {homeRowHeading(shown.variant, t)}
        </h2>
        <div className="flex shrink-0 items-baseline gap-4">
          {shown.variant === 'guides' && (
            <button
              type="button"
              onClick={() => clearInterest()}
              aria-label={t('Clear these suggestions')}
              className="rounded-md text-[13.5px] font-semibold text-ink-muted underline decoration-ink/25 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
            >
              {t('Clear')}
            </button>
          )}
          <Link
            href={seeAll}
            className="text-[14px] font-bold text-teal-dark underline decoration-teal/40 decoration-2 underline-offset-4 hover:decoration-teal"
          >
            {t('See all')}
          </Link>
        </div>
      </div>

      {/* Phones: an edge-to-edge snap rail (the next tile peeks in). sm+: a plain grid. scroll-px-6
          must mirror px-6 — snapping aligns to the padding box, so without it the first tile re-snaps
          flush with the screen edge, 24px left of the heading. */}
      <div className="relative mt-5">
        <ul className="no-bar -mx-6 flex snap-x snap-mandatory scroll-px-6 gap-4 overflow-x-auto px-6 [[data-personal=on]_&]:invisible sm:mx-0 sm:grid sm:grid-cols-3 sm:grid-rows-2 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-6 lg:grid-rows-1">
          {tiles.map((tile) => (
            <li key={tile.tour.slug} className="w-[44%] shrink-0 snap-start sm:w-auto">
              <HomeTourTile tour={tile.tour} image={tile.image} />
            </li>
          ))}
        </ul>
        <TilePlaceholders />
      </div>
    </section>
  );
}

function HomeTourTile({ tour, image }: HomeTour) {
  const t = useT();
  return (
    <Link href={`/activities/${tour.slug}`} className="group block rounded-2xl">
      <div className="aspect-square overflow-hidden rounded-2xl bg-teal-tint">
        <img
          {...responsiveImage(image.url, HOME_TILE)}
          alt={image.alt ?? tour.title}
          width={TILE_SIZE}
          height={TILE_SIZE}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
        />
      </div>
      {/* Always two lines tall (2 × leading-snug) and always a price line: see FOOTPRINT above. */}
      <p className="mt-3 line-clamp-2 min-h-[2.75em] text-[16px] font-extrabold leading-snug tracking-[-0.01em] text-ink decoration-2 underline-offset-4 group-hover:underline">
        {tour.title}
      </p>
      <p className="mt-1 text-[13px] text-ink-muted">
        {tour.fromPriceEur != null ? (
          <>
            {t('from')} <Price eur={tour.fromPriceEur} className="text-[14px] font-bold text-ink" />
            {tour.pricingMode === 'vehicle' && ` ${t('per vehicle')}`}
          </>
        ) : (
          // Same 14px inline as the price, so this line is exactly as tall.
          <span className="text-[14px] font-bold text-ink">{t('On request')}</span>
        )}
      </p>
    </Link>
  );
}

/** What a marked row shows until the client has chosen: the tiles' footprint, greyed. */
function TilePlaceholders() {
  return (
    <div
      aria-hidden
      className="pointer-events-none invisible absolute inset-0 -mx-6 flex gap-4 overflow-hidden px-6 [[data-personal=on]_&]:visible sm:mx-0 sm:grid sm:grid-cols-3 sm:grid-rows-2 sm:gap-5 sm:px-0 lg:grid-cols-6 lg:grid-rows-1"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="w-[44%] shrink-0 sm:w-auto">
          <div className="aspect-square rounded-2xl bg-ink/[0.06]" />
          <div className="mt-3 h-4 w-11/12 rounded bg-ink/[0.06]" />
          <div className="mt-2 h-4 w-7/12 rounded bg-ink/[0.06]" />
        </div>
      ))}
    </div>
  );
}
