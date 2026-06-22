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

/* Region-based transport add-on (per_person / per_group activities). Two tables: the band × vehicle
 * fare grid, and the region-pair near/far map. Both are staff-editable (RLS) via the browser client. */
export type ZoneBand = 'same' | 'near' | 'far';

export interface TransportBandInput {
  band: ZoneBand;
  sedanEur: number;
  suvEur: number;
  familyEur: number;
  vanEur: number;
  coasterEur: number;
}

const BAND_ORDER: ZoneBand[] = ['same', 'near', 'far'];

export async function loadTransportBands(): Promise<TransportBandInput[]> {
  const { data, error } = await getBrowserSupabase()
    .from('transport_band_pricing')
    .select('band, sedan_minor, suv_minor, family_minor, van_minor, coaster_minor');
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({
      band: r.band,
      sedanEur: r.sedan_minor / 100,
      suvEur: r.suv_minor / 100,
      familyEur: r.family_minor / 100,
      vanEur: r.van_minor / 100,
      coasterEur: r.coaster_minor / 100,
    }))
    .sort((a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band));
}

export async function updateTransportBand(input: TransportBandInput): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('transport_band_pricing')
    .update({
      sedan_minor: eurToMinor(input.sedanEur),
      suv_minor: eurToMinor(input.suvEur),
      family_minor: eurToMinor(input.familyEur),
      van_minor: eurToMinor(input.vanEur),
      coaster_minor: eurToMinor(input.coasterEur),
      updated_at: new Date().toISOString(),
    })
    .eq('band', input.band);
  if (error) throw error;
}

export interface RegionPairInput {
  regionA: string;
  regionB: string;
  band: 'near' | 'far';
}

export async function loadRegionDistances(): Promise<RegionPairInput[]> {
  const { data, error } = await getBrowserSupabase()
    .from('region_zone_distance')
    .select('region_a, region_b, band')
    .order('region_a')
    .order('region_b');
  if (error) throw error;
  return (data ?? []).map((r) => ({ regionA: r.region_a, regionB: r.region_b, band: r.band }));
}

export async function updateRegionDistance(regionA: string, regionB: string, band: 'near' | 'far'): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('region_zone_distance')
    .update({ band })
    .eq('region_a', regionA)
    .eq('region_b', regionB);
  if (error) throw error;
}

/* Airport transfers — the destination-region × vehicle fare matrix + the return-trip discount %. One
 * fare row per region (staff-editable via RLS) and a single-row config for the discount. */
export type AirportRegion = 'North' | 'South' | 'East' | 'West' | 'Central';

export interface AirportFareInput {
  region: AirportRegion;
  sedanEur: number;
  suvEur: number;
  familyEur: number;
  vanEur: number;
  coasterEur: number;
}

const AIRPORT_REGION_ORDER: AirportRegion[] = ['North', 'East', 'Central', 'West', 'South'];

export async function loadAirportFares(): Promise<AirportFareInput[]> {
  const { data, error } = await getBrowserSupabase()
    .from('airport_transfer_fare')
    .select('region, sedan_minor, suv_minor, family_minor, van_minor, coaster_minor');
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({
      region: r.region,
      sedanEur: r.sedan_minor / 100,
      suvEur: r.suv_minor / 100,
      familyEur: r.family_minor / 100,
      vanEur: r.van_minor / 100,
      coasterEur: r.coaster_minor / 100,
    }))
    .sort((a, b) => AIRPORT_REGION_ORDER.indexOf(a.region) - AIRPORT_REGION_ORDER.indexOf(b.region));
}

export async function updateAirportFare(input: AirportFareInput): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('airport_transfer_fare')
    .update({
      sedan_minor: eurToMinor(input.sedanEur),
      suv_minor: eurToMinor(input.suvEur),
      family_minor: eurToMinor(input.familyEur),
      van_minor: eurToMinor(input.vanEur),
      coaster_minor: eurToMinor(input.coasterEur),
      updated_at: new Date().toISOString(),
    })
    .eq('region', input.region);
  if (error) throw error;
}

export async function loadAirportReturnDiscount(): Promise<number> {
  const { data, error } = await getBrowserSupabase()
    .from('airport_transfer_config')
    .select('return_discount_pct')
    .eq('id', true)
    .maybeSingle();
  if (error) throw error;
  return data?.return_discount_pct ?? 10;
}

export async function updateAirportReturnDiscount(pct: number): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('airport_transfer_config')
    .update({ return_discount_pct: Math.max(0, Math.min(90, Math.round(pct))), updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) throw error;
}
