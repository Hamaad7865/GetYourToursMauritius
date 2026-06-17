import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';

/**
 * Both pricing configs are staff-editable from the admin screen (browser client + RLS), like
 * categories. Exercises the real write helpers against the real RLS: staff can update both configs;
 * a non-staff authenticated user is silently denied (RLS USING filters the row → 0 rows changed).
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

const {
  loadSightseeingPricing,
  updateSightseeingPricing,
  loadPlannerPricing,
  updatePlannerPricing,
} = await import('@/lib/admin/vehicle-pricing');

describe('admin vehicle pricing editors', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [STAFF]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Cust', 'customer')`, [CUSTOMER]);
    hoisted.shim = makeSupabaseShim(db.pg);
  });

  afterAll(async () => {
    await db.close();
  });

  it('loads the seeded defaults for both configs', async () => {
    await db.as(null);
    expect((await loadSightseeingPricing()).sedanEur).toBe(70);
    const planner = await loadPlannerPricing();
    expect(planner.standardEur).toBe(95);
    expect(planner.coachEur).toBe(250);
    expect(planner.maxParty).toBe(22);
  });

  it('lets staff update both configs', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await updateSightseeingPricing({ sedanEur: 80, suvEur: 95, familyEur: 90, vanEur: 130, coasterEur: 240 });
    await updatePlannerPricing({ standardEur: 99, suvEur: 105, sixEur: 115, vanEur: 160, coachEur: 260, maxParty: 20 });

    await db.as(null);
    expect((await loadSightseeingPricing()).sedanEur).toBe(80);
    const planner = await loadPlannerPricing();
    expect(planner.standardEur).toBe(99);
    expect(planner.maxParty).toBe(20);
  });

  it('silently denies a non-staff update (RLS)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await updatePlannerPricing({ standardEur: 1, suvEur: 1, sixEur: 1, vanEur: 1, coachEur: 1, maxParty: 1 });

    await db.asOwner();
    const { rows } = await db.pg.query<{ standard_minor: number }>(`select standard_minor from planner_pricing limit 1`);
    expect(rows[0]!.standard_minor).toBe(9900); // unchanged from the staff update, not 100
  });
});
