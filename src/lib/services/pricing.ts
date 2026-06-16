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

export interface VehicleBracket {
  label: string;
  amountEur: number;
  maxGuests: number;
}

/**
 * Vehicle pricing: the cheapest bracket whose capacity fits the whole party (a step function, NOT
 * per head). Brackets are price tiers where `maxGuests` is the vehicle's UPPER bound. Throws when
 * the party is larger than the biggest vehicle. The DB (`create_booking`) is authoritative; this
 * mirrors it for the widget + tests.
 */
export function pickVehicleBracket(tiers: PriceTierInput[], people: number): VehicleBracket {
  const fits = tiers
    .filter((t): t is PriceTierInput & { maxGuests: number } => t.maxGuests != null && t.maxGuests >= people)
    .sort((a, b) => a.maxGuests - b.maxGuests);
  const bracket = fits[0];
  if (!bracket) {
    throw new ValidationError(`No vehicle fits ${people} ${people === 1 ? 'person' : 'people'}`);
  }
  return { label: bracket.label, amountEur: bracket.amountEur, maxGuests: bracket.maxGuests };
}

/** The largest party any configured vehicle can carry (0 if none). */
export function maxVehicleCapacity(tiers: PriceTierInput[]): number {
  return tiers.reduce((max, t) => (t.maxGuests != null && t.maxGuests > max ? t.maxGuests : max), 0);
}
