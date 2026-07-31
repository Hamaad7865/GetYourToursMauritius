import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';

const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

// Lives in migrations/, not as a standalone seed: the release pipeline runs `supabase db push`,
// which applies migrations ONLY. As a seed file this content had no route to production at all —
// it shipped in the repo and never reached the database.
const seedSql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260901000400_seed_fr_catalogue.sql'),
  'utf8',
);

// The slugs this seed targets, discovered from its own `where a.slug = '...'` lines rather than
// hardcoded here — so this test keeps working unmodified as batches B and C append more blocks.
const seededSlugs = [...seedSql.matchAll(/where a\.slug = '([^']+)'/g)].map((m) => m[1]!);

// The follow-up that re-applies drafted copy with a PER-FIELD merge, for rows the seed's row-level
// `source = 'machine'` guard skipped wholesale.
const backfillSql = readFileSync(
  join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260901000500_backfill_partial_fr_translations.sql',
  ),
  'utf8',
);

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

  /**
   * The seed's guard is ROW-level, so an owner who reviews a single field locks the whole row out of
   * ever being drafted. That shipped: catapseed-5-islands had an owner-reviewed French title and an
   * English description and highlights on the live site. The backfill re-applies drafted copy with a
   * PER-FIELD merge, which is the rule the rest of this feature already follows.
   */
  describe('per-field backfill for rows the seed skipped', () => {
    it('fills empty fields without touching the field the owner wrote', async () => {
      // The backfill targets one real slug, and seed/catalogue.json (23 activities) does not contain
      // it — so the row has to be created here. Without this the test would early-return and pass
      // while asserting nothing, which is worse than no test.
      await db.pg.query(
        `insert into activities (operator_id, slug, title, category)
         select a.operator_id, 'catapseed-5-islands', 'Private Cataspeed 5 Islands', a.category
           from activities a limit 1
         on conflict (slug) do nothing`,
      );

      // Reproduce the live state exactly: an owner-reviewed title, nothing else translated.
      await db.pg.query(
        `insert into activity_translations (activity_id, locale, title, source)
         select a.id, 'fr', 'Titre écrit par le propriétaire', 'human'
           from activities a where a.slug = 'catapseed-5-islands'
         on conflict (activity_id, locale) do update
           set title = excluded.title, summary = null, description = null,
               highlights = '{}', inclusions = '{}', exclusions = '{}', source = 'human'`,
      );

      await db.pg.exec(backfillSql);

      const { rows } = await db.pg.query<{
        title: string;
        description: string | null;
        n_highlights: number;
        source: string;
      }>(
        `select t.title, t.description, coalesce(array_length(t.highlights, 1), 0) as n_highlights,
                t.source
           from activity_translations t join activities a on a.id = t.activity_id
          where a.slug = 'catapseed-5-islands' and t.locale = 'fr'`,
      );

      // The owner's field survives untouched — that is the whole point of the guard.
      expect(rows[0]!.title).toBe('Titre écrit par le propriétaire');
      // The fields they left empty are now filled, rather than staying English forever.
      expect(rows[0]!.description).not.toBeNull();
      expect(Number(rows[0]!.n_highlights)).toBeGreaterThan(0);
      // Flagged for review again, because the row now carries fresh machine copy.
      expect(rows[0]!.source).toBe('machine');
    });
  });
});
