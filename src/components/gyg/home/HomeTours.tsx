import Link from '@/components/site/LocaleLink';
import { getT, getLocale } from '@/lib/i18n/server';
import { localePath } from '@/lib/i18n/routing';
import { categoryHref } from '@/lib/catalogue/category-hubs';
import { pickHomeTours } from '@/lib/catalogue/home-tours';
import { Price } from '@/components/site/Price';
import type { TourSummary } from '@/lib/validation/tours';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** Tiles are drawn at up to ~190 CSS px; these only reserve the square before the photo arrives. */
const TILE_SIZE = 500;

/**
 * The homepage's first row: our own private day tours — North, South, South East and the rest.
 *
 * This row used to show six places (Belle Mare, Le Morne, Port Louis…) linking to their guides. The
 * owner asked for it to show what we actually sell instead: a visitor's first look under the hero
 * should be tours they can book, with a real price on each.
 *
 * Everything on a tile comes from the catalogue (see pickHomeTours) — nothing is hard-coded here.
 * The photos are the owner's own, served at full size because nothing resizes them (see the image
 * notes in the handbook), so they load lazily and the row costs what its heaviest photo weighs.
 */
export async function HomeTours({ activities }: { activities: TourSummary[] }) {
  const tours = pickHomeTours(activities);
  if (tours.length === 0) return null;

  const t = await getT();
  const locale = await getLocale();
  const allHref = localePath(locale, categoryHref(tours[0]!.tour.category));

  return (
    <section aria-labelledby="tours-heading" className="mx-auto max-w-shell px-6 pt-10 sm:pt-12">
      <div className="flex items-end justify-between gap-4">
        <h2
          id="tours-heading"
          className="text-[clamp(21px,2.3vw,26px)] font-extrabold tracking-[-0.02em] text-ink"
        >
          {t('Private day tours with your own driver')}
        </h2>
        <Link
          href={allHref}
          className="shrink-0 text-[14px] font-bold text-teal-dark underline decoration-teal/40 decoration-2 underline-offset-4 hover:decoration-teal"
        >
          {t('See all')}
        </Link>
      </div>

      {/* Phones: an edge-to-edge snap rail (the next tile peeks in). sm+: a plain grid. scroll-px-6
          must mirror px-6 — snapping aligns to the padding box, so without it the first tile re-snaps
          flush with the screen edge, 24px left of the heading. */}
      <ul className="no-bar -mx-6 mt-5 flex snap-x snap-mandatory scroll-px-6 gap-4 overflow-x-auto px-6 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-6">
        {tours.map(({ tour, image }) => (
          <li key={tour.slug} className="w-[44%] shrink-0 snap-start sm:w-auto">
            <Link
              href={localePath(locale, `/activities/${tour.slug}`)}
              className="group block rounded-2xl"
            >
              <div className="aspect-square overflow-hidden rounded-2xl bg-teal-tint">
                <img
                  src={image.url}
                  alt={image.alt ?? tour.title}
                  width={TILE_SIZE}
                  height={TILE_SIZE}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
                />
              </div>
              <p className="mt-3 line-clamp-2 text-[16px] font-extrabold leading-snug tracking-[-0.01em] text-ink decoration-2 underline-offset-4 group-hover:underline">
                {tour.title}
              </p>
              {tour.fromPriceEur != null && (
                <p className="mt-1 text-[13px] text-ink-muted">
                  {t('from')}{' '}
                  <Price eur={tour.fromPriceEur} className="text-[14px] font-bold text-ink" />
                  {tour.pricingMode === 'vehicle' && ` ${t('per vehicle')}`}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
