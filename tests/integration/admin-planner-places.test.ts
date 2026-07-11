import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';

/**
 * Curated places are staff-managed from the admin editor (browser client + RLS), like categories.
 * Exercises the real write helpers against real RLS: staff can create/update/move/delete; a non-staff
 * authenticated user is denied (RLS USING filters the rows).
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

const { loadPlannerPlaces, createPlannerPlace, updatePlannerPlace, deletePlannerPlace } =
  await import('@/lib/admin/planner-places');

const NEW = {
  name: 'QA Test Cove',
  category: 'Beach',
  region: 'West',
  lat: -20.274,
  lng: 57.365,
  durationMin: 90,
  closesAt: null,
  blurb: 'Long west-coast beach with calm swimming.',
  imageUrl: null,
};

describe('admin planner places', () => {
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

  it('staff can create, update and delete a place', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await createPlannerPlace(NEW);
    let rows = await loadPlannerPlaces();
    const created = rows.find((r) => r.id === 'qa-test-cove');
    expect(created).toBeTruthy();
    expect(created!.region).toBe('West');
    expect(created!.lat).toBeCloseTo(-20.274, 3);

    await updatePlannerPlace('qa-test-cove', { ...NEW, durationMin: 120 });
    rows = await loadPlannerPlaces();
    expect(rows.find((r) => r.id === 'qa-test-cove')!.durationMin).toBe(120);

    await deletePlannerPlace('qa-test-cove');
    rows = await loadPlannerPlaces();
    expect(rows.find((r) => r.id === 'qa-test-cove')).toBeUndefined();
  });

  it('denies a non-staff create (RLS rejects the insert)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(createPlannerPlace({ ...NEW, name: 'Sneaky Place' })).rejects.toThrow(
      /row-level security/,
    );
    await db.asOwner();
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from planner_places where id = 'sneaky-place'`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});
