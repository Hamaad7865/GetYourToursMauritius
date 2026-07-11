import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';

/**
 * The rental fleet is admin-managed + WhatsApp-only (no booking/payment). This proves the two halves:
 *  - the public read `api_list_rental_vehicles` returns ONLY active vehicles, ordered, with the seeded
 *    €36 / €20 rates — the exact shape the /rent picker renders;
 *  - RLS: an authenticated staff user can create / edit / remove vehicles through the real admin helpers,
 *    while a non-staff user is silently denied (RLS USING filters the row → 0 rows changed).
 */
const STAFF = 'a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5';
const CUSTOMER = 'c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0';

const hoisted = vi.hoisted(() => ({ shim: null as SupabaseShim | null }));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

const { loadRentalFleet, createRentalVehicle, updateRentalVehicle, deleteRentalVehicle } =
  await import('@/lib/admin/rental');

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

type Listed = { slug: string; name: string; dailyRateEur: number; category: string; seats: number };

describe('rental fleet: public list RPC + admin RLS', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [
      STAFF,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role) values ($1, 'Cust', 'customer')`,
      [CUSTOMER],
    );
    hoisted.shim = makeSupabaseShim(db.pg);
  });

  afterAll(async () => {
    await db.close();
  });

  it('lists the 6 seeded vehicles, ordered, with the €36 / €20 rates (anon)', async () => {
    await db.as(null);
    const items = await call<Listed[]>(db, 'api_list_rental_vehicles', {});
    expect(items).toHaveLength(6);
    // Ordered by sort: cars first (€36), then scooters (€20).
    expect(items[0]).toMatchObject({ slug: 'nissan-march', dailyRateEur: 36, seats: 5 });
    expect(items.find((v) => v.slug === 'suzuki-ertiga')).toMatchObject({
      category: 'family',
      seats: 7,
    });
    expect(items.filter((v) => v.category === 'scooter').every((v) => v.dailyRateEur === 20)).toBe(
      true,
    );
  });

  it('lets staff create, edit and remove vehicles; the list reflects active only', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await createRentalVehicle({
      slug: 'toyota-aqua',
      name: 'Toyota Aqua',
      category: 'economy',
      seats: 5,
      transmission: 'automatic',
      airCon: true,
      imageUrl: null,
      dailyRateEur: 40,
      depositEur: 100,
      sort: 25,
      active: true,
    });
    // Deactivate a seeded vehicle -> it drops out of the public list.
    await updateRentalVehicle({
      slug: 'sym-crox',
      name: 'SYM Crox',
      category: 'scooter',
      seats: 2,
      transmission: 'automatic',
      airCon: false,
      imageUrl: null,
      dailyRateEur: 22,
      depositEur: 0,
      sort: 50,
      active: false,
    });

    await db.as(null);
    const items = await call<Listed[]>(db, 'api_list_rental_vehicles', {});
    const slugs = items.map((v) => v.slug);
    expect(slugs).toContain('toyota-aqua');
    expect(slugs).not.toContain('sym-crox'); // inactive -> hidden
    expect(items.find((v) => v.slug === 'toyota-aqua')).toMatchObject({ dailyRateEur: 40 });

    await db.as({ sub: STAFF, role: 'authenticated' });
    await deleteRentalVehicle('toyota-aqua');
    await db.as(null);
    const after = await call<Listed[]>(db, 'api_list_rental_vehicles', {});
    expect(after.map((v) => v.slug)).not.toContain('toyota-aqua');
  });

  it('silently denies a non-staff write (RLS)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await updateRentalVehicle({
      slug: 'nissan-march',
      name: 'Hacked',
      category: 'economy',
      seats: 5,
      transmission: 'automatic',
      airCon: true,
      imageUrl: null,
      dailyRateEur: 1,
      depositEur: 0,
      sort: 10,
      active: true,
    });

    await db.asOwner();
    const { rows } = await db.pg.query<{ name: string; daily_rate_minor: number }>(
      `select name, daily_rate_minor from rental_vehicles where slug = 'nissan-march'`,
    );
    expect(rows[0]).toMatchObject({ name: 'Nissan March', daily_rate_minor: 3600 }); // unchanged
  });

  it('loads the fleet through the admin helper (staff), newest sort order', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const fleet = await loadRentalFleet();
    expect(fleet.length).toBeGreaterThanOrEqual(6);
    expect(fleet[0]!.sort).toBeLessThanOrEqual(fleet[fleet.length - 1]!.sort);
  });
});
