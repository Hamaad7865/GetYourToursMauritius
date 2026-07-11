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

/**
 * The tier whose price FRONTS an option card, mirroring the server's from-price rule (migrations
 * 20260750/20260751): an AGE-BANDED option shows its full adult price — the max tier — never the free
 * infant band (a "€0 per person" card); a non-banded option shows its cheapest non-free tier, falling
 * back to the plain cheapest when every tier is free. Display-only — booking math never uses this.
 */
export function displayFromTier(option: TourOption): TierLite | null {
  const banded = option.prices.some((p) => p.minAge != null || p.maxAge != null);
  const lite = (p: TourOption['prices'][number]): TierLite => ({
    label: p.label,
    amountEur: p.amountEur,
    maxGuests: p.maxGuests,
  });
  let best: TierLite | null = null;
  if (banded) {
    for (const p of option.prices) {
      if (!best || p.amountEur > best.amountEur) best = lite(p);
    }
    return best;
  }
  for (const p of option.prices) {
    if (p.amountEur > 0 && (!best || p.amountEur < best.amountEur)) best = lite(p);
  }
  return best ?? cheapestTier(option);
}

/** Default selected option: options[0] for vehicle, else the option with the lowest FRONT price
 *  (displayFromTier — so a free infant band never decides the default over the real adult prices). */
export function defaultOptionId(options: TourOption[], isVehicle: boolean): string | null {
  const first = options[0];
  if (!first) return null;
  if (isVehicle) return first.id;
  let bestId: string | null = null;
  let bestEur = Infinity;
  for (const o of options) {
    const t = displayFromTier(o);
    if (t && t.amountEur < bestEur) {
      bestEur = t.amountEur;
      bestId = o.id;
    }
  }
  return bestId ?? first.id;
}

export interface PrivateConfig {
  baseEur: number;
  included: number;
  extraEur: number;
  maxGuests: number;
}

/** The option's private-trip config (base covers `included` guests, `extraEur` per additional head,
 *  `maxGuests` cap), or null for a normal option. Non-null base ⇒ private — the DB constraint
 *  guarantees the other fields come with it, but degrade to null if a partial payload slips through. */
export function privateConfig(option: TourOption): PrivateConfig | null {
  if (option.privateBaseEur == null) return null;
  const included = option.privateIncluded ?? null;
  const extraEur = option.privateExtraEur ?? null;
  const maxGuests = option.privateMaxGuests ?? null;
  if (included == null || extraEur == null || maxGuests == null) return null;
  return { baseEur: option.privateBaseEur, included, extraEur, maxGuests };
}

/** The "From" headline price for an activity. Prefers the server's `fromPriceEur` (the min across
 *  per-person / tier prices); when that's null — a PRIVATE-ONLY activity has no tier rows, so the
 *  server can't derive one — it falls back to the cheapest private option's base, so the card reads
 *  "From €X per private trip" instead of "On request". */
export function activityFromPriceEur(activity: {
  fromPriceEur: number | null;
  options: TourOption[];
}): number | null {
  if (activity.fromPriceEur != null) return activity.fromPriceEur;
  const bases = activity.options
    .map((o) => privateConfig(o)?.baseEur)
    .filter((n): n is number => typeof n === 'number');
  return bases.length ? Math.min(...bases) : null;
}

export interface OptionCardSummary {
  name: string;
  fromPriceEur: number | null;
  maxGuests: number | null;
  unitNote: string;
  isPrivate: boolean;
}

/** Display fields for one option card. unitNote follows the pricing mode/type, mirroring the widget's unitLabel. */
export function optionCardSummary(
  option: TourOption,
  mode: PricingMode,
  type: TourType,
): OptionCardSummary {
  const priv = privateConfig(option);
  if (priv) {
    // Private trip: flat base for up to `included` guests; the card shows the base as the from-price.
    return {
      name: option.name,
      fromPriceEur: priv.baseEur,
      maxGuests: priv.maxGuests,
      unitNote: 'per private trip',
      isPrivate: true,
    };
  }
  const t = displayFromTier(option);
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
  return {
    name: option.name,
    fromPriceEur: t?.amountEur ?? null,
    maxGuests,
    unitNote,
    isPrivate: false,
  };
}
