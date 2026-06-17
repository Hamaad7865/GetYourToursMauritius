'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { PLANNER_DEFAULT, type PlannerPricing } from '@/lib/planner/pricing';
import type { PlannerPlace } from '@/lib/validation/planner';

export interface PlannerData {
  places: PlannerPlace[];
  pricing: PlannerPricing;
  loading: boolean;
  error: string | null;
}

/**
 * Loads the planner's curated places + flat vehicle pricing from Supabase (both public-read). Prices
 * here are display-only — the booking re-prices server-side from `planner_pricing` (`vehicle_custom`),
 * so a tampered client can never change what's charged. Falls back to the built-in defaults for
 * pricing so the page still quotes if the config row is missing.
 */
export function usePlannerData(): PlannerData {
  const [places, setPlaces] = useState<PlannerPlace[]>([]);
  const [pricing, setPricing] = useState<PlannerPricing>(PLANNER_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const sb = getBrowserSupabase();
        const [placesRes, pricingRes] = await Promise.all([
          sb
            .from('planner_places')
            .select('id,name,category,region,lat,lng,duration_min,closes_at,blurb,image_url')
            .order('position'),
          sb
            .from('planner_pricing')
            .select('standard_minor,suv_minor,six_minor,van_minor,coach_minor,max_party')
            .eq('id', true)
            .maybeSingle(),
        ]);
        if (!active) return;
        if (placesRes.error) throw placesRes.error;
        setPlaces(
          (placesRes.data ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            region: p.region,
            lat: Number(p.lat),
            lng: Number(p.lng),
            durationMin: p.duration_min,
            closesAt: p.closes_at ? String(p.closes_at).slice(0, 5) : null,
            blurb: p.blurb,
            imageUrl: p.image_url,
          })),
        );
        const pr = pricingRes.data;
        if (pr) {
          setPricing({
            standardEur: pr.standard_minor / 100,
            suvEur: pr.suv_minor / 100,
            sixEur: pr.six_minor / 100,
            vanEur: pr.van_minor / 100,
            coachEur: pr.coach_minor / 100,
            maxParty: pr.max_party,
          });
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load the planner.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { places, pricing, loading, error };
}
