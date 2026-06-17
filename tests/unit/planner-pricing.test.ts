import { describe, expect, it } from 'vitest';
import {
  PLANNER_DEFAULT,
  placeCountWarning,
  plannerQuote,
  type PlannerPricing,
} from '@/lib/planner/pricing';

/**
 * The planner's flat per-vehicle pricing is a PARALLEL path to sightseeing pricing — its own
 * brackets/names/cap. This pure logic mirrors the SQL `vehicle_custom` branch of create_booking;
 * a divergence here is a real bug (the DB stays authoritative, this drives the widget + tests).
 */
const CFG: PlannerPricing = PLANNER_DEFAULT;

describe('plannerQuote', () => {
  it('prices 1–4 as a Standard car at €95 by default', () => {
    expect(plannerQuote(1, false, CFG)).toEqual({ vehicle: 'Standard car', totalEur: 95 });
    expect(plannerQuote(4, false, CFG)).toEqual({ vehicle: 'Standard car', totalEur: 95 });
  });

  it('upgrades 1–4 to an SUV at €100 when chosen', () => {
    expect(plannerQuote(2, true, CFG)).toEqual({ vehicle: 'SUV', totalEur: 100 });
  });

  it('ignores the SUV flag above 4 people', () => {
    expect(plannerQuote(6, true, CFG)).toEqual({ vehicle: '6-seater', totalEur: 110 });
  });

  it('prices the 5–6, 7–14 and 15–22 bands', () => {
    expect(plannerQuote(5, false, CFG)).toEqual({ vehicle: '6-seater', totalEur: 110 });
    expect(plannerQuote(7, false, CFG)).toEqual({ vehicle: 'Van', totalEur: 150 });
    expect(plannerQuote(14, false, CFG)).toEqual({ vehicle: 'Van', totalEur: 150 });
    expect(plannerQuote(15, false, CFG)).toEqual({ vehicle: 'Coach', totalEur: 250 });
    expect(plannerQuote(22, false, CFG)).toEqual({ vehicle: 'Coach', totalEur: 250 });
  });

  it('rejects a party outside 1..maxParty', () => {
    expect(() => plannerQuote(0, false, CFG)).toThrow();
    expect(() => plannerQuote(23, false, CFG)).toThrow();
  });
});

describe('placeCountWarning', () => {
  it('is null for five or fewer stops', () => {
    expect(placeCountWarning(0)).toBeNull();
    expect(placeCountWarning(5)).toBeNull();
  });
  it('warns at six or more stops', () => {
    expect(placeCountWarning(6)).toMatch(/more than 5 places/i);
  });
});
