import type { PricingMode, TourOption } from '@/lib/validation/tours';
import type { TourType } from '@/lib/validation/common';

export interface TierLite {
  label: string;
  amountEur: number;
  maxGuests: number | null;
}

/** The option's lowest-priced tier, or null when it has none. */
export function cheapestTier(option: TourOption): TierLite | null {
  let best: TierLite | null = null;
  for (const p of option.prices) {
    if (!best || p.amountEur < best.amountEur) {
      best = { label: p.label, amountEur: p.amountEur, maxGuests: p.maxGuests };
    }
  }
  return best;
}

/** Default selected option: options[0] for vehicle, else the option holding the globally cheapest tier. */
export function defaultOptionId(options: TourOption[], isVehicle: boolean): string | null {
  const first = options[0];
  if (!first) return null;
  if (isVehicle) return first.id;
  let bestId: string | null = null;
  let bestEur = Infinity;
  for (const o of options) {
    const t = cheapestTier(o);
    if (t && t.amountEur < bestEur) {
      bestEur = t.amountEur;
      bestId = o.id;
    }
  }
  return bestId ?? first.id;
}

export interface OptionCardSummary {
  name: string;
  fromPriceEur: number | null;
  maxGuests: number | null;
  unitNote: string;
}

/** Display fields for one option card. unitNote follows the pricing mode/type, mirroring the widget's unitLabel. */
export function optionCardSummary(
  option: TourOption,
  mode: PricingMode,
  type: TourType,
): OptionCardSummary {
  const t = cheapestTier(option);
  const maxGuests = t?.maxGuests ?? null;
  const unitNote =
    mode === 'vehicle'
      ? 'per vehicle'
      : mode === 'per_group'
        ? maxGuests
          ? `per group up to ${maxGuests}`
          : 'per group'
        : type === 'transport'
          ? 'per vehicle'
          : 'per person';
  return { name: option.name, fromPriceEur: t?.amountEur ?? null, maxGuests, unitNote };
}
