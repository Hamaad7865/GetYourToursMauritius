import { getBrowserSupabase } from '@/lib/supabase/browser';

/* Admin CRUD for the rental fleet. `rental_vehicles` is staff-editable via RLS, so the authenticated
 * admin reads and writes it directly through the browser client — the same pattern as the pricing
 * editors, but multi-row (add / edit / remove vehicles). Money is stored as integer EUR cents. */

export interface RentalVehicleInput {
  slug: string;
  name: string;
  category: string;
  seats: number;
  transmission: string | null;
  airCon: boolean;
  imageUrl: string | null;
  dailyRateEur: number;
  depositEur: number;
  sort: number;
  active: boolean;
}

function eurToMinor(eur: number): number {
  return Math.round(eur * 100);
}

export async function loadRentalFleet(): Promise<RentalVehicleInput[]> {
  const { data, error } = await getBrowserSupabase()
    .from('rental_vehicles')
    .select('slug, name, category, seats, transmission, air_con, image_url, daily_rate_minor, deposit_minor, sort, active')
    .order('sort', { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      category: r.category,
      seats: r.seats,
      transmission: r.transmission,
      airCon: r.air_con,
      imageUrl: r.image_url,
      dailyRateEur: r.daily_rate_minor / 100,
      depositEur: r.deposit_minor / 100,
      sort: r.sort,
      active: r.active,
    }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/** Row payload shared by create + update (slug is the key, set separately on insert). */
function toRow(input: RentalVehicleInput) {
  return {
    name: input.name.trim(),
    category: (input.category || 'car').trim().toLowerCase(),
    seats: Math.max(1, Math.round(input.seats)),
    transmission: input.transmission?.trim() || null,
    air_con: input.airCon,
    image_url: input.imageUrl?.trim() || null,
    daily_rate_minor: eurToMinor(input.dailyRateEur),
    deposit_minor: eurToMinor(input.depositEur),
    sort: Math.round(input.sort),
    active: input.active,
    updated_at: new Date().toISOString(),
  };
}

export async function createRentalVehicle(input: RentalVehicleInput): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('rental_vehicles')
    .insert({ slug: input.slug.trim(), ...toRow(input) });
  if (error) throw error;
}

export async function updateRentalVehicle(input: RentalVehicleInput): Promise<void> {
  const { error } = await getBrowserSupabase()
    .from('rental_vehicles')
    .update(toRow(input))
    .eq('slug', input.slug);
  if (error) throw error;
}

export async function deleteRentalVehicle(slug: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('rental_vehicles').delete().eq('slug', slug);
  if (error) throw error;
}
