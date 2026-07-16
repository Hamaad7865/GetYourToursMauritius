import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Per-category standard content (migration 20260811000000).
 * Spec: docs/superpowers/specs/2026-07-16-activity-content-defaults-design.md
 *
 * The migration carries the ONLY surviving copy of the text that used to live in
 * src/lib/content/{sightseeing,catamaran}.ts — those files are deleted — so these tests are what stop
 * that content silently disappearing.
 */
const STAFF = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
const CUSTOMER = 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2';

describe('activity_content_defaults', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff'), ($2, 'customer')`, [
      STAFF,
      CUSTOMER,
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('seeds the two sets that replace the deleted hardcoded files', async () => {
    await db.asOwner();
    const { rows } = await db.pg.query<{
      category: string;
      highlights: number;
      bring: number;
      important: number;
    }>(`select category,
               cardinality(highlights) as highlights,
               cardinality(what_to_bring) as bring,
               cardinality(important_info) as important
          from activity_content_defaults order by category`);
    expect(rows).toEqual([
      // was CATAMARAN_WHAT_TO_BRING (9) + CATAMARAN_KNOW_BEFORE (8); catamaran never had highlights
      { category: 'Catamaran cruises', highlights: 0, bring: 9, important: 8 },
      // was SIGHTSEEING_HIGHLIGHTS (6) + SIGHTSEEING_IMPORTANT_INFO (5)
      { category: 'Taxi Sightseeing tours', highlights: 6, bring: 0, important: 5 },
    ]);
  });

  it('keeps the exact text, including a curly apostrophe that would break naive SQL escaping', async () => {
    await db.asOwner();
    const { rows } = await db.pg.query<{ line: string }>(
      `select important_info[6] as line from activity_content_defaults where category = 'Catamaran cruises'`,
    );
    expect(rows[0]!.line).toBe(
      'The captain’s decisions regarding navigation, timing, and itinerary adjustments are final and made in the interest of guest safety.',
    );
  });

  it('re-seeding never overwrites content the owner has edited', async () => {
    await db.asOwner();
    await db.pg.query(
      `update activity_content_defaults set highlights = ARRAY['Owner edit']::text[] where category = 'Catamaran cruises'`,
    );
    // The migration's seed runs again on every catch-up.sql re-run — it must not stomp this.
    await db.pg.exec(`
      insert into activity_content_defaults (category, what_to_bring) values
        ('Catamaran cruises', ARRAY['Seed value']::text[])
      on conflict (category) do nothing;`);
    const { rows } = await db.pg.query<{ h: string[] }>(
      `select highlights as h from activity_content_defaults where category = 'Catamaran cruises'`,
    );
    expect(rows[0]!.h).toEqual(['Owner edit']);
  });

  it('api_content_defaults is readable by anon (the activity page is public)', async () => {
    await db.as(null);
    const { rows } = await db.pg.query<{ d: Record<string, { highlights: string[] }> }>(
      `select api_content_defaults('{}'::jsonb) as d`,
    );
    const d = rows[0]!.d;
    expect(Object.keys(d).sort()).toEqual(['Catamaran cruises', 'Taxi Sightseeing tours']);
    expect(d['Taxi Sightseeing tours']!.highlights).toHaveLength(6);
  });

  it('RLS: staff may write, a customer may not', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(
      `insert into activity_content_defaults (category, inclusions) values ('Speedboat Tours', ARRAY['Fuel']::text[])`,
    );

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      db.pg.query(
        `insert into activity_content_defaults (category, inclusions) values ('Air activities', ARRAY['Hack']::text[])`,
      ),
    ).rejects.toThrow();

    await db.asOwner();
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from activity_content_defaults where category = 'Air activities'`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});

/**
 * REGRESSION — the landmine the spec calls "the single most likely way this feature rots".
 * `updateCategory` re-points activities.category on rename; standard content is keyed by the same
 * free-text name, so it must be re-pointed too or the category silently loses its standard content.
 * The admin path runs in the browser (supabase-js), so this pins the DB-level contract it relies on:
 * the re-point is a plain UPDATE and nothing (FK/policy/constraint) blocks it.
 */
describe('category rename re-points standard content', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
  });
  afterAll(async () => {
    await db.close();
  });

  it('renaming carries the standard set to the new name', async () => {
    await db.pg.query(
      `update activity_content_defaults set category = 'Taxi Tours' where category = 'Taxi Sightseeing tours'`,
    );
    const { rows } = await db.pg.query<{ n: number }>(
      `select cardinality(highlights)::int as n from activity_content_defaults where category = 'Taxi Tours'`,
    );
    expect(rows[0]!.n).toBe(6);
    const { rows: old } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from activity_content_defaults where category = 'Taxi Sightseeing tours'`,
    );
    expect(old[0]!.n).toBe(0);
  });
});
