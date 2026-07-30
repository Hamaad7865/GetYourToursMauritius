import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';

const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

const seedSql = readFileSync(join(process.cwd(), 'supabase', 'seed-fr-catalogue.sql'), 'utf8');

// The slugs this seed targets, discovered from its own `where a.slug = '...'` lines rather than
// hardcoded here — so this test keeps working unmodified as batches B and C append more blocks.
const seededSlugs = [...seedSql.matchAll(/where a\.slug = '([^']+)'/g)].map((m) => m[1]!);

/**
 * seed-fr-catalogue.sql is hand-written SQL that nothing else parses — no schema validates it, no
 * TypeScript type-checks it. Without this test, a stray straight quote or a mismatched array length
 * would only surface the first time someone ran it against a real database, which today means
 * production. Running it here against a real (PGlite) Postgres is the only thing standing between a
 * bad quote and a silent failed deploy.
 */
describe('French catalogue seed (seed-fr-catalogue.sql)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));

    // catalogueToSeedSql plants its own 'fr' row (source defaults to 'human') for every activity in
    // the fixture, including a few slugs this seed also targets (e.g. north-tour, airport-transfer).
    // That's fixture noise, not a real owner review, and it would otherwise mask the very guard
    // we're testing: seed-fr-catalogue.sql correctly REFUSES to touch a 'human' row, so those rows
    // would survive untouched and make "every row it inserts is machine" look false. Clear them so
    // this beforeAll exercises a clean insert path; the "does not clobber" test below plants its own
    // deliberate 'human' rows to verify the guard directly.
    await db.pg.query(`delete from activity_translations where locale = 'fr'`);

    // This exec IS the point of the test: seed-fr-catalogue.sql is hand-written SQL that nothing
    // else parses, so if it throws here (a stray straight quote, a mismatched array length, an
    // unbalanced string), beforeAll fails and every test below reports it clearly.
    await db.pg.exec(seedSql);
  });

  afterAll(async () => {
    await db.close?.();
  });

  it('every row it inserts lands as source = machine', async () => {
    // seed/catalogue.json (the test fixture) only carries a handful of the activities this seed
    // targets — the rest simply match no row in `activities` and insert nothing, which is expected
    // (see the seed's own `where a.slug = '...'` guard). Scope the assertion to the slugs this seed
    // actually targets: activity_translations also holds 'human' rows for every OTHER fixture
    // activity (planted by the base catalogue seed itself), and those must be left alone.
    expect(seededSlugs.length).toBeGreaterThan(0);
    const { rows } = await db.pg.query<{ n: string }>(
      `select count(*)::text as n from activity_translations t
         join activities a on a.id = t.activity_id
        where t.locale = 'fr' and a.slug = any($1::text[]) and t.source <> 'machine'`,
      [seededSlugs],
    );
    expect(rows[0]!.n).toBe('0');

    const { rows: total } = await db.pg.query<{ n: string }>(
      `select count(*)::text as n from activity_translations t
         join activities a on a.id = t.activity_id
        where t.locale = 'fr' and a.slug = any($1::text[])`,
      [seededSlugs],
    );
    expect(Number(total[0]!.n)).toBeGreaterThan(0);
  });

  it('a re-run does not clobber owner-reviewed copy', async () => {
    await db.pg.query(
      `update activity_translations set title = 'Titre approuvé', source = 'human'
       where locale = 'fr' and title is not null`,
    );
    await db.pg.exec(seedSql);
    const { rows } = await db.pg.query<{ n: string }>(
      `select count(*)::text as n from activity_translations
        where locale = 'fr' and source = 'human' and title <> 'Titre approuvé'`,
    );
    expect(rows[0]!.n).toBe('0');
  });
});
