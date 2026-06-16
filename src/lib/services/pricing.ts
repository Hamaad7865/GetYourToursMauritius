import { ValidationError } from './errors';

/**
 * Pure pricing logic. No I/O, no provider calls, fully deterministic — the most
 * valuable unit-test target and the foundation of every money path. Prices are
 * always sourced from the database (never the client) and passed in here.
 *
 * All arithmetic is done in integer cents to avoid floating-point drift, then
 * converted back to EUR for the result.
 */
export interface PriceTierInput {
  /** Tier label, e.g. "Adult", "Child", "Private group", "Per day". */
  label: string;
  /** Unit price in EUR. */
  amountEur: number;
  /** Optional cap on quantity for this tier (null = uncapped). */
  maxGuests?: number | null;
}

export interface QuoteLine {
  label: string;
  unitAmountEur: number;
  quantity: number;
  subtotalEur: number;
}

export interface Quote {
  lines: QuoteLine[];
  totalEur: number;
  totalGuests: number;
}

/** Map of tier label -> selected quantity. */
export type PartySelection = Record<string, number>;

export function eurToCents(amountEur: number): number {
  if (!Number.isFinite(amountEur) || amountEur < 0) {
    throw new ValidationError(`Invalid EUR amount: ${amountEur}`);
  }
  return Math.round(amountEur * 100);
}

export function centsToEur(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Compute a quote for a party selection against a set of price tiers.
 * Throws ValidationError on unknown tiers, duplicate tier labels, non-integer or
 * negative quantities, exceeding a tier cap, or an empty selection.
 */
export function quoteTotal(tiers: PriceTierInput[], party: PartySelection): Quote {
  if (tiers.length === 0) {
    throw new ValidationError('No price tiers available for this tour');
  }

  const tierByLabel = new Map<string, PriceTierInput>();
  for (const tier of tiers) {
    if (tierByLabel.has(tier.label)) {
      throw new ValidationError(`Duplicate price tier label: "${tier.label}"`);
    }
    tierByLabel.set(tier.label, tier);
  }

  const lines: QuoteLine[] = [];
  let totalCents = 0;
  let totalGuests = 0;

  for (const [label, quantity] of Object.entries(party)) {
    const tier = tierByLabel.get(label);
    if (!tier) {
      throw new ValidationError(`Unknown price tier: "${label}"`);
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new ValidationError(`Quantity for "${label}" must be a non-negative integer`);
    }
    if (quantity === 0) {
      continue;
    }
    if (tier.maxGuests != null && quantity > tier.maxGuests) {
      throw new ValidationError(
        `Quantity for "${label}" (${quantity}) exceeds the maximum of ${tier.maxGuests}`,
      );
    }

    const unitCents = eurToCents(tier.amountEur);
    const subtotalCents = unitCents * quantity;
    totalCents += subtotalCents;
    totalGuests += quantity;

    lines.push({
      label,
      unitAmountEur: centsToEur(unitCents),
      quantity,
      subtotalEur: centsToEur(subtotalCents),
    });
  }

  if (lines.length === 0) {
    throw new ValidationError('Select at least one guest');
  }

  return {
    lines,
    totalEur: centsToEur(totalCents),
    totalGuests,
  };
}

export interface SightseeingPricing {
  /** €70 per block of `blockSize` people. */
  perBlockEur: number;
  /** Flat SUV upgrade price for parties of 1..blockSize. */
  suvFlatEur: number;
  blockSize: number;
  maxParty: number;
}

/** Sensible defaults if the catalogue config hasn't loaded — mirrors the migration's seed row. */
export const SIGHTSEEING_DEFAULT: SightseeingPricing = {
  perBlockEur: 70,
  suvFlatEur: 85,
  blockSize: 4,
  maxParty: 25,
};

/** Vehicle name by party size. NAME only — the price comes from the per-block rule. MUST mirror the
 *  SQL `CASE` in create_booking (Sedan ≤4, Family car ≤6, Minibus ≤14, Coaster ≤25). */
export const VEHICLE_BANDS: ReadonlyArray<{ max: number; name: string }> = [
  { max: 4, name: 'Sedan' },
  { max: 6, name: 'Family car' },
  { max: 14, name: 'Minibus' },
  { max: 25, name: 'Coaster' },
];

export interface SightseeingQuote {
  vehicle: string;
  totalEur: number;
}

/**
 * Sightseeing price for a party: €70 × ceil(people / 4), or the flat SUV price for parties of 1..4
 * when `suv` is set. The DB (`create_booking`) is authoritative; this mirrors it for the widget and
 * unit tests. Throws outside 1..maxParty.
 */
export function sightseeingQuote(people: number, suv: boolean, cfg: SightseeingPricing): SightseeingQuote {
  if (!Number.isInteger(people) || people < 1 || people > cfg.maxParty) {
    throw new ValidationError(`Party of ${people} is outside 1–${cfg.maxParty}`);
  }
  if (people <= cfg.blockSize && suv) {
    return { vehicle: 'SUV', totalEur: cfg.suvFlatEur };
  }
  const band = VEHICLE_BANDS.find((b) => people <= b.max) ?? VEHICLE_BANDS[VEHICLE_BANDS.length - 1]!;
  const blocks = Math.ceil(people / cfg.blockSize);
  return { vehicle: band.name, totalEur: cfg.perBlockEur * blocks };
}
