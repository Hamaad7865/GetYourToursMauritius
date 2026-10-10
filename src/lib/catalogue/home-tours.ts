import { isSightseeingCategory } from '@/lib/categories/categories';
import type { TourImage, TourSummary } from '@/lib/validation/tours';

/** How many tours the homepage row shows: one line of six on a desktop. */
export const HOME_TOURS_MAX = 6;

export interface HomeTour {
  tour: TourSummary;
  image: TourImage;
}

/**
 * The tours for the homepage's first row: our private day tours — North, South, South East and the
 * rest of the sightseeing category — each with the photo its tile will show.
 *
 * Nothing here is a hand-kept list. Which tours appear, their names, their prices and their order all
 * come from the catalogue, so publishing a tour, renaming it, repricing it or dragging it to a new
 * position in /admin changes this row without a code change. (`activities` arrives in the catalogue's
 * own order, which is the admin's drag-and-drop order within a category.)
 *
 * A tour with no photo is left out rather than shown as an empty tile.
 */
export function pickHomeTours(
  activities: readonly TourSummary[],
  max: number = HOME_TOURS_MAX,
): HomeTour[] {
  const out: HomeTour[] = [];
  for (const tour of activities) {
    if (out.length >= max) break;
    if (!isSightseeingCategory(tour.category)) continue;
    const image = tour.heroImage ?? tour.images[0];
    if (!image) continue;
    out.push({ tour, image });
  }
  return out;
}
