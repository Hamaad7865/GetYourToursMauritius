import { ValidationError } from '@/lib/services/errors';

/**
 * Pure pricing logic for the AI Road Trip Planner — a PARALLEL path to sightseeing vehicle pricing
 * (`src/lib/services/pricing.ts`), with the planner's own flat per-vehicle rates, vehicle names and
 * cap. No I/O; the DB (`create_booking` `vehicle_custom` branch) stays authoritative, this mirrors it
 * for the widget + unit tests, so the two MUST agree (a test pins that).
 */
export interface PlannerPricing {
  standardEur: number; // 1–4
  suvEur: number; // 1–4 upgrade
  sixEur: number; // 5–6
  vanEur: number; // 7–14
  coachEur: number; // 15–maxParty
  maxParty: number;
}

/** Owner-confirmed defaults; mirrors the seed row in the planner-pricing migration. */
export const PLANNER_DEFAULT: PlannerPricing = {
  standardEur: 95,
  suvEur: 100,
  sixEur: 110,
  vanEur: 150,
  coachEur: 250,
  maxParty: 22,
};

export interface PlannerQuote {
  vehicle: string;
  totalEur: number;
}

/**
 * One flat price for the vehicle that fits the party — Standard car €95 (SUV €100) for 1–4, 6-seater
 * €110 for 5–6, Van €150 for 7–14, Coach €250 for 15–22. Mirrors the SQL `vehicle_custom` branch.
 * Throws outside 1..maxParty (the page shows "contact us" instead).
 */
export function plannerQuote(people: number, suv: boolean, cfg: PlannerPricing): PlannerQuote {
  if (!Number.isInteger(people) || people < 1 || people > cfg.maxParty) {
    throw new ValidationError(`Party of ${people} is outside 1–${cfg.maxParty}`);
  }
  if (people <= 4) {
    return suv
      ? { vehicle: 'SUV', totalEur: cfg.suvEur }
      : { vehicle: 'Standard car', totalEur: cfg.standardEur };
  }
  if (people <= 6) return { vehicle: '6-seater', totalEur: cfg.sixEur };
  if (people <= 14) return { vehicle: 'Van', totalEur: cfg.vanEur };
  return { vehicle: 'Coach', totalEur: cfg.coachEur };
}

const MAX_COMFORTABLE_STOPS = 5;

/** Soft warning when a day has too many stops; null within limits (adding is still allowed). */
export function placeCountWarning(stopCount: number): string | null {
  if (stopCount <= MAX_COMFORTABLE_STOPS) return null;
  return "More than 5 places in one day is extremely hard — you won't have time to explore each site well.";
}
