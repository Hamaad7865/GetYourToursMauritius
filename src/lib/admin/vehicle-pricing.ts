import { getBrowserSupabase } from '@/lib/supabase/browser';

/* Admin editing of the two vehicle-pricing configs. Both are single-row tables (`id = true`); staff
 * RLS grants update, so the authenticated admin edits them directly through the browser client — the
 * same pattern as categories. Amounts are stored as integer minor units, edited in EUR. */

function eurToMinor(eur: number): number {
  return Math.round(eur * 100);
}

/** Sightseeing tours — the existing global flat-vehicle prices. */
export interface SightseeingPricingInput {
  sedanEur: number;
  suvEur: number;
  familyEur: number;
  vanEur: number;
  coasterEur: number;
}

export async function loadSightseeingPricing(): Promise<SightseeingPricingInput> {
  const { data, error } = await getBrowserSupabase()
    .from('sightseeing_pricing')
    .select('sedan_minor, suv_minor, family_minor, van_minor, coaster_minor')
    .eq('id', true)
    .maybeSingle();
  if (error) throw error;
  return {
    sedanEur: (data?.sedan_minor ?? 0) / 100,
    suvEur: (data?.suv_minor ?? 0) / 100,
    familyEur: (data?.family_minor ?? 0) / 100,
    vanEur: (data?.van_minor ?? 0) / 100,
    coasterEur: (data?.coaster_minor ?? 0) / 100,
  };
}

export async function updateSightseeingPricing(input: SightseeingPricingInput): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('sightseeing_pricing')
    .update({
      sedan_minor: eurToMinor(input.sedanEur),
      suv_minor: eurToMinor(input.suvEur),
      family_minor: eurToMinor(input.familyEur),
      van_minor: eurToMinor(input.vanEur),
      coaster_minor: eurToMinor(input.coasterEur),
      updated_at: new Date().toISOString(),
    })
    .eq('id', true);
  if (error) throw error;
}

/** Custom road trips — the AI Road Trip Planner's own flat-vehicle prices. */
export interface PlannerPricingInput {
  standardEur: number;
  suvEur: number;
  sixEur: number;
  vanEur: number;
  coachEur: number;
  maxParty: number;
}

export async function loadPlannerPricing(): Promise<PlannerPricingInput> {
  const { data, error } = await getBrowserSupabase()
    .from('planner_pricing')
    .select('standard_minor, suv_minor, six_minor, van_minor, coach_minor, max_party')
    .eq('id', true)
    .maybeSingle();
  if (error) throw error;
  return {
    standardEur: (data?.standard_minor ?? 0) / 100,
    suvEur: (data?.suv_minor ?? 0) / 100,
    sixEur: (data?.six_minor ?? 0) / 100,
    vanEur: (data?.van_minor ?? 0) / 100,
    coachEur: (data?.coach_minor ?? 0) / 100,
    maxParty: data?.max_party ?? 22,
  };
}

export async function updatePlannerPricing(input: PlannerPricingInput): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('planner_pricing')
    .update({
      standard_minor: eurToMinor(input.standardEur),
      suv_minor: eurToMinor(input.suvEur),
      six_minor: eurToMinor(input.sixEur),
      van_minor: eurToMinor(input.vanEur),
      coach_minor: eurToMinor(input.coachEur),
      max_party: Math.round(input.maxParty),
      updated_at: new Date().toISOString(),
    })
    .eq('id', true);
  if (error) throw error;
}
