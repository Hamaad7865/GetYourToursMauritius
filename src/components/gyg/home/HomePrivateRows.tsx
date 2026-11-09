import Link from '@/components/site/LocaleLink';
import { getT } from '@/lib/i18n/server';
import { categoryHref } from '@/lib/catalogue/category-hubs';
import { chooseHomeRow } from '@/lib/catalogue/home-row';
import { pickHomeTours, pickPrivateCruises, type HomeTour } from '@/lib/catalogue/home-tours';
import type { HomePicks } from '@/lib/validation/home-picks';
import type { TourSummary } from '@/lib/validation/tours';
import { HomeTourTile } from './HomeToursRow';

/** A category row with fewer tiles than this looks broken, so it is left out. */
const MIN_TILES = 3;

/**
 * Two rows under the personalised first row, both about what we run privately: the private boat
 * trips (catamaran, speedboat, dolphins), then the private day tours with a driver. The owner asked
 * for private experiences to lead the homepage (2026-11-09), and since the first row became
 * personalised ("Most booked by our guests" by default), the private day tours had no row of their own.
 *
 * Both rows come straight from the catalogue, in the admin's order: publishing, renaming, repricing
 * or reordering a tour in /admin changes them without a code change. Unlike the first row they are
 * the same for every visitor, so the server renders them whole and Google sees them.
 *
 * The driver-tours row is skipped when the first row already fell back to those same tours (no
 * booking picks to show).
 */
export async function HomePrivateRows({
  activities,
  picks,
}: {
  activities: TourSummary[];
  picks: HomePicks | null;
}) {
  const t = await getT();
  const firstRow = chooseHomeRow({ activities, picks, tomorrow: null });
  const cruises = pickPrivateCruises(activities);
  const tours = firstRow.variant === 'private' ? [] : pickHomeTours(activities);

  return (
    <>
      {cruises.length >= MIN_TILES && (
        <CategoryRow
          id="private-cruises-heading"
          heading={t('Private boat trips, just your group')}
          seeAll={categoryHref(cruises[0]!.tour.category)}
          seeAllLabel={t('See all')}
          tiles={cruises}
        />
      )}
      {tours.length >= MIN_TILES && (
        <CategoryRow
          id="private-tours-heading"
          heading={t('Private day tours with your own driver')}
          seeAll={categoryHref(tours[0]!.tour.category)}
          seeAllLabel={t('See all')}
          tiles={tours}
        />
      )}
    </>
  );
}

function CategoryRow({
  id,
  heading,
  seeAll,
  seeAllLabel,
  tiles,
}: {
  id: string;
  heading: string;
  seeAll: string;
  seeAllLabel: string;
  tiles: HomeTour[];
}) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-shell px-6 pt-10 sm:pt-12">
      <div className="flex items-end justify-between gap-4">
        <h2
          id={id}
          className="text-[clamp(21px,2.3vw,26px)] font-extrabold tracking-[-0.02em] text-ink"
        >
          {heading}
        </h2>
        <Link
          href={seeAll}
          className="shrink-0 text-[14px] font-bold text-teal-dark underline decoration-teal/40 decoration-2 underline-offset-4 hover:decoration-teal"
        >
          {seeAllLabel}
        </Link>
      </div>
      {/* Same layout as the first row: an edge-to-edge snap rail on phones (scroll-px-6 mirrors
          px-6), a 3-column grid from sm, one line of six from lg. */}
      <ul className="no-bar -mx-6 mt-5 flex snap-x snap-mandatory scroll-px-6 gap-4 overflow-x-auto px-6 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-6">
        {tiles.map((tile) => (
          <li key={tile.tour.slug} className="w-[44%] shrink-0 snap-start sm:w-auto">
            <HomeTourTile tour={tile.tour} image={tile.image} />
          </li>
        ))}
      </ul>
    </section>
  );
}
