'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { PLANNER_DEFAULT, type PlannerPricing } from '@/lib/planner/pricing';

/**
 * Loads the planner's flat vehicle pricing from Supabase (public read). Places are no longer seeded —
 * they come live from Google Places (the drawer + co-pilot) — so this hook only carries pricing.
 * Prices are display-only; the booking re-prices server-side (`vehicle_custom`). Falls back to the
 * built-in defaults so the page always quotes.
 */
export function usePlannerData(): { pricing: PlannerPricing } {
  const [pricing, setPricing] = useState<PlannerPricing>(PLANNER_DEFAULT);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const sb = getBrowserSupabase();
        const { data } = await sb
          .from('planner_pricing')
          .select('standard_minor,suv_minor,six_minor,van_minor,coach_minor,max_party')
          .eq('id', true)
          .maybeSingle();
        if (active && data) {
          setPricing({
            standardEur: data.standard_minor / 100,
            suvEur: data.suv_minor / 100,
            sixEur: data.six_minor / 100,
            vanEur: data.van_minor / 100,
            coachEur: data.coach_minor / 100,
            maxParty: data.max_party,
          });
        }
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { pricing };
}
