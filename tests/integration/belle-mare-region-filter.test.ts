import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

/**
 * api_search_activities' `region` filter (added for the Belle Mare activities showcase) and the
 * one-time backfill that sets `region` from `location` for previously-untagged Private Cruises rows.
 */
async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('api_search_activities region filter', () => {
  let db: TestDb;
  let eastId: string;
  let westId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    const east = await seedOccurrence(db, 5);
    const west = await seedOccurrence(db, 5);
    eastId = east.activityId;
    westId = west.activityId;
    await db.pg.query(`update activities set region = 'East' where id = $1`, [eastId]);
    await db.pg.query(`update activities set region = 'West' where id = $1`, [westId]);
  });

  afterAll(async () => {
    await db.close();
  });

  async function search(params: Record<string, unknown>): Promise<string[]> {
    const res = await call<{ items: Array<{ id: string }> }>(db, 'api_search_activities', {
      pageSize: 50,
      ...params,
    });
    return res.items.map((i) => i.id).filter((id) => id === eastId || id === westId);
  }

  it('filters to the given region', async () => {
    expect(await search({ region: 'East' })).toEqual([eastId]);
    expect(await search({ region: 'West' })).toEqual([westId]);
  });

  it('is a no-op when region is omitted (backward compatible)', async () => {
    expect((await search({})).sort()).toEqual([eastId, westId].sort());
  });

  it('returns nothing for a region with no matches', async () => {
    expect(await search({ region: 'North' })).toEqual([]);
  });
});

describe('Private Cruises region backfill', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  /** Re-runs the migration's own backfill statement to prove its logic on freshly-seeded rows —
   *  the migration's one-time run at DB creation happened before these test rows existed. */
  async function rerunBackfill(): Promise<void> {
    await db.pg.exec(`
      update activities
      set region = location
      where category = 'Private Cruises'
        and pricing_mode = 'per_person'
        and region is null
        and location in ('North', 'East', 'South', 'West', 'Central');
    `);
  }

  it('fills a null region from location when the category/pricing_mode match', async () => {
    const seeded = await seedOccurrence(db, 5);
    await db.pg.query(
      `update activities set category = 'Private Cruises', pricing_mode = 'per_person', region = null, location = 'East' where id = $1`,
      [seeded.activityId],
    );
    await rerunBackfill();
    const { rows } = await db.pg.query<{ region: string | null }>(
      `select region from activities where id = $1`,
      [seeded.activityId],
    );
    expect(rows[0]!.region).toBe('East');
  });

  it('never overwrites an already-set region', async () => {
    const seeded = await seedOccurrence(db, 5);
    await db.pg.query(
      `update activities set category = 'Private Cruises', pricing_mode = 'per_person', region = 'West', location = 'East' where id = $1`,
      [seeded.activityId],
    );
    await rerunBackfill();
    const { rows } = await db.pg.query<{ region: string | null }>(
      `select region from activities where id = $1`,
      [seeded.activityId],
    );
    expect(rows[0]!.region).toBe('West'); // untouched — location says East, but region was already West
  });

  it('does not touch a different category', async () => {
    const seeded = await seedOccurrence(db, 5); // category defaults to 'Catamaran cruises'
    await db.pg.query(
      `update activities set pricing_mode = 'per_person', region = null, location = 'East' where id = $1`,
      [seeded.activityId],
    );
    await rerunBackfill();
    const { rows } = await db.pg.query<{ region: string | null }>(
      `select region from activities where id = $1`,
      [seeded.activityId],
    );
    expect(rows[0]!.region).toBeNull(); // wrong category — untouched
  });

  it('does not touch a different pricing_mode', async () => {
    const seeded = await seedOccurrence(db, 5);
    await db.pg.query(
      `update activities set category = 'Private Cruises', pricing_mode = 'vehicle', region = null, location = 'East' where id = $1`,
      [seeded.activityId],
    );
    await rerunBackfill();
    const { rows } = await db.pg.query<{ region: string | null }>(
      `select region from activities where id = $1`,
      [seeded.activityId],
    );
    expect(rows[0]!.region).toBeNull(); // wrong pricing_mode (vehicle, not per_person) — untouched
  });

  it('does not touch a non-canonical location value', async () => {
    const seeded = await seedOccurrence(db, 5);
    await db.pg.query(
      `update activities set category = 'Private Cruises', pricing_mode = 'per_person', region = null, location = 'Grand Baie' where id = $1`,
      [seeded.activityId],
    );
    await rerunBackfill();
    const { rows } = await db.pg.query<{ region: string | null }>(
      `select region from activities where id = $1`,
      [seeded.activityId],
    );
    expect(rows[0]!.region).toBeNull(); // 'Grand Baie' isn't a canonical region string — untouched
  });
});
