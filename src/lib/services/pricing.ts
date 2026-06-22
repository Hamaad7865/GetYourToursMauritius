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

/** Flat price per vehicle bracket (sightseeing tours). All amounts in EUR. */
export interface SightseeingPricing {
  sedanEur: number; // 1–4
  suvEur: number; // 1–4 upgrade
  familyEur: number; // 5–6
  vanEur: number; // 7–14
  coasterEur: number; // 15–25
  maxParty: number;
}

/** Sensible defaults if the catalogue config hasn't loaded — mirrors the migration's seed row. */
export const SIGHTSEEING_DEFAULT: SightseeingPricing = {
  sedanEur: 70,
  suvEur: 85,
  familyEur: 85,
  vanEur: 125,
  coasterEur: 225,
  maxParty: 25,
};

/** The SUV upgrade is offered only at the entry (Sedan) tier. */
export const SIGHTSEEING_SUV_MAX = 4;

/** Vehicle name by party size. NAME only — the price comes from the flat bracket. MUST mirror the
 *  SQL `CASE` in create_booking (Sedan ≤4, Family car ≤6, Van ≤14, Coaster ≤25). */
export const VEHICLE_BANDS: ReadonlyArray<{ max: number; name: string }> = [
  { max: 4, name: 'Sedan' },
  { max: 6, name: 'Family car' },
  { max: 14, name: 'Van' },
  { max: 25, name: 'Coaster' },
];

export interface SightseeingQuote {
  vehicle: string;
  totalEur: number;
}

/**
 * Sightseeing price for a party: ONE flat price for the vehicle bracket that fits — Sedan €70 (SUV €85)
 * for 1–4, Family car €85 for 5–6, Van €125 for 7–14, Coaster €225 for 15–25. The DB
 * (`create_booking`) is authoritative; this mirrors it for the widget and unit tests. Throws outside
 * 1..maxParty.
 */
export function sightseeingQuote(people: number, suv: boolean, cfg: SightseeingPricing): SightseeingQuote {
  if (!Number.isInteger(people) || people < 1 || people > cfg.maxParty) {
    throw new ValidationError(`Party of ${people} is outside 1–${cfg.maxParty}`);
  }
  if (people <= 4) {
    return suv ? { vehicle: 'SUV', totalEur: cfg.suvEur } : { vehicle: 'Sedan', totalEur: cfg.sedanEur };
  }
  if (people <= 6) return { vehicle: 'Family car', totalEur: cfg.familyEur };
  if (people <= 14) return { vehicle: 'Van', totalEur: cfg.vanEur };
  return { vehicle: 'Coaster', totalEur: cfg.coasterEur };
}

/** Price per extra child seat (the first seat is free). */
export const CHILD_SEAT_EUR = 6;

/** Cost of `seats` child seats: the first is free, each additional is €6. Mirrors api_book; the DB is
 *  authoritative. */
export function childSeatsCost(seats: number): number {
  return Math.max(0, Math.floor(seats) - 1) * CHILD_SEAT_EUR;
}

// ── Region-based transport add-on ────────────────────────────────────────────
// An OPTIONAL fee for per_person / per_group activities that scales with how far the customer's pickup
// is from the activity's boarding region: same region = short drive = cheap; Near / Far = more. The SQL
// (transport_fare_minor / region_distance_band in 20260720000000_activity_transport_pricing) is
// AUTHORITATIVE; everything below mirrors it cent-for-cent for the live widget quote. All amounts are in
// integer minor units (EUR cents), exactly like the DB config, so there is no float drift.

/** The five Mauritius zones, matching regionFromCoords() in google-places.ts and region_from_coords() in SQL. */
export const REGIONS = ['North', 'South', 'East', 'West', 'Central'] as const;
export type Region = (typeof REGIONS)[number];

/** Coarse N/S/E/W/Central region from Mauritius coordinates. The single source of this logic: SQL's
 *  region_from_coords() ports the SAME thresholds, and google-places.ts re-exports this function (so the
 *  planner, the widget and the server all classify a point identically). Pure — safe in client bundles. */
export function regionFromCoords(lat: number, lng: number): Region {
  if (lat >= -20.08) return 'North';
  if (lat <= -20.42) return 'South';
  if (lng >= 57.63) return 'East';
  if (lng <= 57.43) return 'West';
  return 'Central';
}

/** Distance band between a pickup region and an activity's region. */
export type ZoneBand = 'same' | 'near' | 'far';

/** One flat fare per vehicle bracket, for a single distance band (minor units / EUR cents). */
export interface TransportBandFare {
  sedanMinor: number; // 1-4
  suvMinor: number; // 1-4 upgrade
  familyMinor: number; // 5-6
  vanMinor: number; // 7-14
  coasterMinor: number; // 15-25 (×N coasters above 25)
}

/** Fares for all three bands — the global config (one row per band in transport_band_pricing). */
export type TransportBandPricing = Record<ZoneBand, TransportBandFare>;

/** Unordered region-pair -> near|far. Keyed `${lo}|${hi}` with lo < hi (lexicographic), mirroring the
 *  SQL least/greatest. Same-region is handled as 'same' and is not stored. */
export type RegionDistanceMap = Record<string, 'near' | 'far'>;

/** Defaults mirroring the migration seed — used as a fallback and by the unit tests. */
export const TRANSPORT_BANDS_DEFAULT: TransportBandPricing = {
  same: { sedanMinor: 1500, suvMinor: 2000, familyMinor: 2500, vanMinor: 4000, coasterMinor: 7000 },
  near: { sedanMinor: 3000, suvMinor: 3800, familyMinor: 4500, vanMinor: 7000, coasterMinor: 12000 },
  far: { sedanMinor: 5000, suvMinor: 6000, familyMinor: 7000, vanMinor: 11000, coasterMinor: 18000 },
};

/** Region-pair distances mirroring the migration seed (lo|hi keys). */
export const REGION_DISTANCE_DEFAULT: RegionDistanceMap = {
  'Central|East': 'near',
  'Central|North': 'near',
  'Central|South': 'near',
  'Central|West': 'near',
  'East|North': 'near',
  'East|South': 'near',
  'East|West': 'far',
  'North|South': 'far',
  'North|West': 'near',
  'South|West': 'near',
};

/** Distance band for two regions: 'same' if equal, else the seeded near/far for the unordered pair
 *  ('far' when missing — fail safe to the higher fare). Mirrors region_distance_band() in SQL. */
export function regionDistanceBand(a: string | null, b: string | null, distances: RegionDistanceMap): ZoneBand {
  if (!a || !b) return 'far';
  if (a === b) return 'same';
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return distances[`${lo}|${hi}`] ?? 'far';
}

/**
 * Transport fare in MINOR units (EUR cents) for a party, mirroring transport_fare_minor() in SQL
 * cent-for-cent: band lookup -> vehicle bracket by party size (Sedan ≤4, Family ≤6, Van ≤14, Coaster
 * ≤25, ×ceil(pax/25) coasters above 25); SUV is the ≤4 upgrade. Returns 0 when a region or pickup is
 * missing (no pickup -> no fee).
 */
export function transportFareMinor(
  pickupRegion: string | null,
  activityRegion: string | null,
  pax: number,
  suv: boolean,
  bands: Record<string, TransportBandFare>,
  distances: RegionDistanceMap,
): number {
  if (!pickupRegion || !activityRegion || !Number.isFinite(pax) || pax < 1) return 0;
  const row = bands[regionDistanceBand(pickupRegion, activityRegion, distances)];
  if (!row) return 0;
  if (pax <= 4) return suv ? row.suvMinor : row.sedanMinor;
  if (pax <= 6) return row.familyMinor;
  if (pax <= 14) return row.vanMinor;
  if (pax <= 25) return row.coasterMinor;
  return row.coasterMinor * Math.ceil(pax / 25);
}

/** As {@link transportFareMinor}, but in EUR — for the widget quote line (`<Price>` takes EUR). */
export function transportFare(
  pickupRegion: string | null,
  activityRegion: string | null,
  pax: number,
  suv: boolean,
  bands: Record<string, TransportBandFare>,
  distances: RegionDistanceMap,
): number {
  return centsToEur(transportFareMinor(pickupRegion, activityRegion, pax, suv, bands, distances));
}

// ── Airport transfers (zone × vehicle fare matrix) ───────────────────────────
// A FIXED transfer fare priced by the destination ZONE (SSR airport is the fixed origin) × vehicle
// bracket (derived from party size + the ≤4 SUV upgrade), one-way or return (return = two legs minus a
// configurable discount). There are just TWO zones: Zone 2 is the near-airport south-east cluster
// (Shandrani, Preskil, Blue Bay, Mahébourg, Pointe d'Esny, …); Zone 1 is everywhere else. The SQL
// (airport_transfer_fare_minor in 20260731000000 + the return-discount in api_book) is AUTHORITATIVE;
// everything below mirrors it cent-for-cent for the hotel-page widget. All amounts are integer minor
// units (EUR cents).

export type TripType = 'one_way' | 'return';

/** One of the two airport-transfer pricing zones. */
export type AirportZone = 'zone1' | 'zone2';

/** Hotel slugs in Zone 2 (the near-airport south-east cluster). The DB (airport_transfer_hotels.zone) is
 *  AUTHORITATIVE — api_book re-derives the zone from the slug. This mirror only feeds the client widget's
 *  display quote; keep it in sync with the migration when hotels are added/reclassified. */
export const AIRPORT_ZONE2_SLUGS: ReadonlySet<string> = new Set(['shandrani-beachcomber', 'preskil-island-resort']);

/** The pricing zone for a hotel slug (Zone 2 for the near-airport cluster, else Zone 1). Display-only;
 *  the server is authoritative. */
export function airportZoneForSlug(slug: string | null | undefined): AirportZone {
  return slug && AIRPORT_ZONE2_SLUGS.has(slug) ? 'zone2' : 'zone1';
}

/** Zone 2 AREAS (the near-airport south-east cluster) for the "my hotel isn't listed" free-text path.
 *  Lower-cased, accent-stripped substrings — the guest may type "Mahebourg" or "Mahébourg". Mirrors
 *  airport_transfer_area_zone() in SQL. */
const AIRPORT_ZONE2_AREAS: readonly string[] = [
  'mahebourg',
  'blue bay',
  "pointe d'esny",
  'ferney',
  'grand port',
];

/** Classify a free-text drop-off AREA to a pricing zone (Zone 2 = near-airport south-east, else Zone 1).
 *  Used when the guest's hotel isn't in our list. Display-only; the server re-derives + enforces it. */
export function airportAreaZone(area: string | null | undefined): AirportZone {
  const v = (area ?? '').trim().toLowerCase().replace(/é/g, 'e');
  if (!v) return 'zone1';
  return AIRPORT_ZONE2_AREAS.some((a) => v.includes(a)) ? 'zone2' : 'zone1';
}

/** One flat fare per vehicle bracket, for a single zone (minor units / EUR cents). */
export interface AirportFare {
  sedanMinor: number; // 1-4 (Standard car)
  suvMinor: number; // 1-4 upgrade
  familyMinor: number; // 5-6 (Family car)
  vanMinor: number; // 7-14 (Minibus)
  coasterMinor: number; // 15-25 (×N coasters above 25)
}

/** Fares for both zones (one row per zone in airport_transfer_fare). */
export type AirportFareByZone = Record<string, AirportFare>;

/** Defaults mirroring the migration seed — used as a fallback and by the unit tests. Zone 2 standard
 *  car = €35 (confirmed); every other cell is an owner-tunable placeholder set in the admin screen. */
export const AIRPORT_FARE_DEFAULT: AirportFareByZone = {
  zone2: { sedanMinor: 3500, suvMinor: 4800, familyMinor: 5500, vanMinor: 8500, coasterMinor: 14500 },
  zone1: { sedanMinor: 5500, suvMinor: 7000, familyMinor: 8000, vanMinor: 12000, coasterMinor: 20000 },
};

/** Default return-trip discount (%) — mirrors airport_transfer_config.return_discount_pct. */
export const AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT = 10;

/** Friendly vehicle-class name for a party size (+ the ≤4 SUV upgrade), for the booking widget. */
export function airportVehicleLabel(pax: number, suv: boolean): string {
  if (pax <= 4) return suv ? 'SUV' : 'Standard car';
  if (pax <= 6) return 'Family car';
  if (pax <= 14) return 'Minibus';
  return 'Coaster';
}

/**
 * One-way airport-transfer fare in MINOR units for a party, mirroring airport_transfer_fare_minor() in
 * SQL cent-for-cent: zone row -> vehicle bracket by party size (Sedan ≤4, Family ≤6, Van ≤14, Coaster
 * ≤25, ×ceil(pax/25) coasters above 25); SUV is the ≤4 upgrade. Returns 0 when the zone/party is
 * missing or unknown.
 */
export function airportTransferFareMinor(
  zone: string | null,
  pax: number,
  suv: boolean,
  fares: AirportFareByZone,
): number {
  if (!zone || !Number.isFinite(pax) || pax < 1) return 0;
  const row = fares[zone];
  if (!row) return 0;
  if (pax <= 4) return suv ? row.suvMinor : row.sedanMinor;
  if (pax <= 6) return row.familyMinor;
  if (pax <= 14) return row.vanMinor;
  if (pax <= 25) return row.coasterMinor;
  return row.coasterMinor * Math.ceil(pax / 25);
}

/**
 * Total airport-transfer fare in MINOR units: one-way = the matrix fare; return = two legs minus the
 * configured discount (rounded once to whole cents). Mirrors the return formula in api_book.
 */
export function airportTransferQuoteMinor(
  zone: string | null,
  pax: number,
  suv: boolean,
  tripType: TripType,
  fares: AirportFareByZone,
  returnDiscountPct: number,
): number {
  const oneWay = airportTransferFareMinor(zone, pax, suv, fares);
  if (oneWay <= 0) return 0;
  if (tripType !== 'return') return oneWay;
  const pct = Number.isFinite(returnDiscountPct) ? returnDiscountPct : 0;
  return Math.round((oneWay * 2 * (100 - pct)) / 100);
}

/** As {@link airportTransferQuoteMinor}, but in EUR — for the widget quote (`<Price>` takes EUR). */
export function airportTransferQuote(
  zone: string | null,
  pax: number,
  suv: boolean,
  tripType: TripType,
  fares: AirportFareByZone,
  returnDiscountPct: number,
): number {
  return centsToEur(airportTransferQuoteMinor(zone, pax, suv, tripType, fares, returnDiscountPct));
}
