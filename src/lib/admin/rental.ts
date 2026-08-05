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
    .select(
      'slug, name, category, seats, transmission, air_con, image_url, daily_rate_minor, deposit_minor, sort, active',
    )
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

/** True for Postgres 23503 (foreign_key_violation), whichever transport surfaced it. */
function isForeignKeyViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '23503') return true;
  // Postgres words a RESTRICT violation differently ("violates RESTRICT setting of foreign key
  // constraint …") from a plain NO ACTION one, so match the part they share.
  const message = error instanceof Error ? error.message : String(error);
  return /foreign key constraint/i.test(message);
}

/**
 * How many priced booking lines still name this vehicle.
 *
 * `booking_custom_items` arrived with the quotes module (migration 20260909000000) and is not in the
 * generated src/lib/supabase/types.ts yet, so this one count reads through an untyped view of the
 * client rather than dragging a types regeneration into a delete-error message.
 */
async function countBookingLinesFor(slug: string): Promise<number> {
  const untyped = getBrowserSupabase() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => PromiseLike<{ data: unknown[] | null }>;
      };
    };
  };
  const { data } = await untyped
    .from('booking_custom_items')
    .select('id')
    .eq('rental_vehicle_slug', slug);
  return (data ?? []).length;
}

export async function deleteRentalVehicle(slug: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('rental_vehicles').delete().eq('slug', slug);
  if (!error) return;

  // booking_custom_items.rental_vehicle_slug is ON DELETE RESTRICT by design: a priced booking line
  // must keep naming the vehicle it was sold as. Postgres says that with a bare 23503 naming a
  // constraint, which reached the fleet screen verbatim — a string the operator cannot act on.
  // Translate it into the decision they actually have, the way src/lib/services/db-errors.ts
  // translates the booking path's constraint failures. (Draft quote lines never land here: their FK
  // is ON DELETE SET NULL.)
  if (isForeignKeyViolation(error)) {
    const count = await countBookingLinesFor(slug);
    throw new Error(
      `This vehicle appears on ${count} booking line${count === 1 ? '' : 's'} and cannot be removed. Untick “Active” instead — it disappears from the rental page but stays readable on those bookings.`,
    );
  }
  throw error;
}
