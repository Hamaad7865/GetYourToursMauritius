import type { TourSummary } from '@/lib/validation/tours';
import { VEHICLE_BANDS } from '@/lib/services/pricing';

/* What a catalogue card says next to a tour's "From" price, and how long it runs. Shared by every
 * card that shows a from-price (the grid card, the homepage "Continue planning" card) so no surface
 * can print "per person" under a per-vehicle or per-group figure. Client-safe and pure: the caller
 * passes its own translate function. */

type T = (key: string, vars?: Record<string, string | number>) => string;

export function durationLabel(minutes: number | null, t: T): string | null {
  if (minutes == null) return null;
  if (minutes < 60) return t('{n} min', { n: minutes });
  const h = minutes / 60;
  const rounded = Number.isInteger(h) ? h : Math.round(h * 10) / 10;
  return rounded === 1 ? t('{n} hour', { n: rounded }) : t('{n} hours', { n: rounded });
}

/**
 * What the "From" price buys. Price unit follows what staff set. A TRANSFER reads "per vehicle" (a
 * transfer genuinely prices per vehicle, capacity varies). A vehicle-priced SIGHTSEEING tour reads
 * "per group up to 4 people" — the "From" price is the entry Sedan (VEHICLE_BANDS[0], up to 4), which
 * is clearer to customers than "per vehicle"; bigger parties auto-price up to the next vehicle on the
 * detail page. per-group reads "per group up to N people"; otherwise per person.
 */
export function priceUnit(
  activity: Pick<TourSummary, 'type' | 'pricingMode' | 'fromPriceIncluded' | 'fromPriceMaxGuests'>,
  t: T,
): string {
  const groupSize = activity.fromPriceMaxGuests;
  // A private-only activity's from-price is the flat charter base — "per person" would misstate a
  // price that covers up to N guests (fromPriceIncluded is only set for that case).
  if (activity.fromPriceIncluded != null) {
    return t('up to {n} people', { n: activity.fromPriceIncluded });
  }
  if (activity.type === 'transport') return t('per vehicle');
  if (activity.pricingMode === 'vehicle') {
    return t('per group up to {n} people', { n: VEHICLE_BANDS[0]!.max });
  }
  if (activity.pricingMode === 'per_group') {
    // Always read as a group price; only append "up to N" when the size is known. Falling back
    // to "per person" for a per_group tour (missing maxGuests) misrepresents the price.
    return groupSize && groupSize > 1
      ? t('per group up to {n} people', { n: groupSize })
      : t('per group');
  }
  return t('per person');
}
