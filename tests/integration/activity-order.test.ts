import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

/**
 * Admin-managed activity card ordering: `api_reorder_activities` sets each activity's `sort` to its array
 * index (staff-only), and `api_search_activities` orders by `sort` first — so the owner's drag order drives
 * the public cards. Because an activity has one category, this reorders only that category's cards.
 */
const STAFF = 'a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5';
const CUSTOMER = 'c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [JSON.stringify(params)]);
  return rows[0]!.data;
}

describe('activity card ordering', () => {
  let db: TestDb;
  let ids: string[];

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    // Three published 'Catamaran cruises' activities (seedOccurrence uses that category + an Adult price).
    const a = await seedOccurrence(db, 5);
    const b = await seedOccurrence(db, 5);
    const c = await seedOccurrence(db, 5);
    ids = [a.activityId, b.activityId, c.activityId];
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [STAFF]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
  });

  afterAll(async () => {
    await db.close();
  });

  async function catamaranOrder(): Promise<string[]> {
    const res = await call<{ items: Array<{ id: string }> }>(db, 'api_search_activities', {
      category: 'Catamaran cruises',
      pageSize: 50,
    });
    return res.items.map((i) => i.id).filter((id) => ids.includes(id));
  }

  it('lists all three by default (sort = 0 → rating/title tiebreak)', async () => {
    await db.asOwner();
    expect((await catamaranOrder()).sort()).toEqual([...ids].sort());
  });

  it('staff reorder drives the public order', async () => {
    const desired = [ids[2]!, ids[0]!, ids[1]!]; // c, a, b
    await db.as({ sub: STAFF, role: 'authenticated' });
    // The reorder is category-scoped server-side now (a stray cross-category id can't be renumbered),
    // so the caller passes the category alongside the ids.
    await call(db, 'api_reorder_activities', { ids: desired, category: 'Catamaran cruises' });
    await db.asOwner();
    expect(await catamaranOrder()).toEqual(desired);
  });

  it('ignores ids outside the given category (server-scoped)', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    // Reorder under a DIFFERENT category: none of these Catamaran ids belong to it, so nothing is
    // renumbered — the previous order is preserved (no cross-category scramble).
    const before = await (async () => { await db.asOwner(); return catamaranOrder(); })();
    await db.as({ sub: STAFF, role: 'authenticated' });
    await call(db, 'api_reorder_activities', { ids: [ids[0]!, ids[1]!, ids[2]!], category: 'Sightseeing tours' });
    await db.asOwner();
    expect(await catamaranOrder()).toEqual(before);
  });

  it('rejects a non-staff reorder', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(call(db, 'api_reorder_activities', { ids })).rejects.toThrow(/forbidden/);
  });
});
