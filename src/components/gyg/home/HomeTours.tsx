import type { TourSummary } from '@/lib/validation/tours';
import type { HomePicks } from '@/lib/validation/home-picks';
import { chooseHomeRow } from '@/lib/catalogue/home-row';
import { HomeToursRow } from './HomeToursRow';
import { HomeToursReserve } from './HomeToursReserve';

/**
 * The homepage's first row (see HomeToursRow and chooseHomeRow). The page is edge-cached and identical
 * for everyone, so the server knows neither the guides a visitor read nor where they are: it renders
 * "Most booked by our guests" — or, when the picks are missing or too thin, our private day tours, the
 * row this used to be — and the browser takes it from there.
 */
export function HomeTours({
  activities,
  picks,
}: {
  activities: TourSummary[];
  picks: HomePicks | null;
}) {
  const row = chooseHomeRow({ activities, picks, tomorrow: null });
  if (row.tiles.length === 0) return null;

  return (
    <>
      <HomeToursRow
        serverVariant={row.variant}
        serverSlugs={row.tiles.map((x) => x.tour.slug)}
        serverPicks={picks}
      />
      {/* Must directly follow the row it marks. */}
      <HomeToursReserve />
    </>
  );
}
