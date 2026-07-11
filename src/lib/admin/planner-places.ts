import { getBrowserSupabase } from '@/lib/supabase/browser';
import { slugify } from './activity-write';

/* Admin management of the curated planner places. Staff RLS (`planner_places_staff`) grants full
 * read+write, so the authenticated admin edits them directly through the browser client — same
 * pattern as categories. */

export const PLACE_CATEGORIES = [
  'Beach',
  'Waterfall',
  'Viewpoint',
  'Nature',
  'Culture',
  'Garden',
  'Island',
  'Market',
  'Landmark',
  'Food',
] as const;
export const PLACE_REGIONS = ['North', 'South', 'East', 'West', 'Central'] as const;

export interface PlannerPlaceRow {
  id: string;
  name: string;
  category: string;
  region: string;
  lat: number;
  lng: number;
  durationMin: number;
  closesAt: string | null;
  blurb: string | null;
  imageUrl: string | null;
  position: number;
}

export interface PlannerPlaceInput {
  name: string;
  category: string;
  region: string;
  lat: number;
  lng: number;
  durationMin: number;
  closesAt: string | null;
  blurb: string | null;
  imageUrl: string | null;
}

export async function loadPlannerPlaces(): Promise<PlannerPlaceRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from('planner_places')
    .select(
      'id, name, category, region, lat, lng, duration_min, closes_at, blurb, image_url, position',
    )
    .order('position');
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    region: p.region,
    lat: Number(p.lat),
    lng: Number(p.lng),
    durationMin: p.duration_min,
    closesAt: p.closes_at,
    blurb: p.blurb,
    imageUrl: p.image_url,
    position: p.position,
  }));
}

function row(input: PlannerPlaceInput) {
  return {
    name: input.name.trim(),
    category: input.category,
    region: input.region,
    lat: input.lat,
    lng: input.lng,
    duration_min: Math.round(input.durationMin),
    closes_at: input.closesAt?.trim() || null,
    blurb: input.blurb?.trim() || null,
    image_url: input.imageUrl?.trim() || null,
  };
}

export async function createPlannerPlace(input: PlannerPlaceInput): Promise<void> {
  const sb = getBrowserSupabase();
  // Next position = max + 1 (read ascending, take the last; avoids a desc/limit the test shim lacks).
  const { data: existing } = await sb.from('planner_places').select('position').order('position');
  const last = existing && existing.length ? existing[existing.length - 1]!.position : -1;
  const { error } = await sb.from('planner_places').insert({
    id: slugify(input.name),
    ...row(input),
    position: last + 1,
  });
  if (error) throw error;
}

export async function updatePlannerPlace(id: string, input: PlannerPlaceInput): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('planner_places')
    .update(row(input))
    .eq('id', id);
  if (error) throw error;
}

/** Move a place up/down by swapping its position with its neighbour. */
export async function movePlannerPlace(
  rows: PlannerPlaceRow[],
  id: string,
  dir: -1 | 1,
): Promise<void> {
  const idx = rows.findIndex((r) => r.id === id);
  const swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= rows.length) return;
  const a = rows[idx]!;
  const b = rows[swapIdx]!;
  const sb = getBrowserSupabase();
  const { error: e1 } = await sb
    .from('planner_places')
    .update({ position: b.position })
    .eq('id', a.id);
  if (e1) throw e1;
  const { error: e2 } = await sb
    .from('planner_places')
    .update({ position: a.position })
    .eq('id', b.id);
  if (e2) throw e2;
}

export async function deletePlannerPlace(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('planner_places').delete().eq('id', id);
  if (error) throw error;
}
