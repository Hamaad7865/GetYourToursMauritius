import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';

const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

async function rpc<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

interface Detail {
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
}

/**
 * The per-field coalesce is the load-bearing detail of this whole feature: it is what makes partial
 * translation safe, which in turn is what lets French copy land incrementally instead of in one big
 * bang. A row-level fallback would blank every untranslated field on a half-translated activity.
 */
describe('locale-aware catalogue RPCs', () => {
  let db: TestDb;
  let slug: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));

    // Every activity in seed/catalogue.json currently ships an `fr` block (catalogueToSeedSql inserts
    // a French translations row for each), so picking two published activities and deleting one's
    // French row is how we get a genuinely untranslated activity for the last test below — the fixture
    // itself has to create that state since the seed no longer does.
    const { rows } = await db.pg.query<{ id: string; slug: string }>(
      `select id, slug from activities where status = 'published' order by slug limit 2`,
    );
    slug = rows[0]!.slug;

    // Deliberately partial: title translated, description NOT. Overwrite whatever the seed already
    // inserted for this activity's `fr` row so the fixture is unambiguous.
    await db.pg.query(
      `insert into activity_translations (activity_id, locale, title, summary, description, source)
       values ($1, 'fr', 'Titre en français', null, null, 'machine')
       on conflict (activity_id, locale) do update
         set title = excluded.title, summary = null, description = null, source = excluded.source`,
      [rows[0]!.id],
    );

    // Second activity: strip its French row entirely so it has NO French translation at all.
    await db.pg.query(`delete from activity_translations where activity_id = $1 and locale = 'fr'`, [
      rows[1]!.id,
    ]);
  });

  afterAll(async () => {
    await db.close?.();
  });

  it('returns English when no locale is supplied', async () => {
    const a = await rpc<Detail>(db, 'api_get_activity', { slug });
    expect(a.title).not.toBe('Titre en français');
  });

  it('returns English when the locale is en', async () => {
    const a = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'en' });
    expect(a.title).not.toBe('Titre en français');
  });

  it('returns the French title when the locale is fr', async () => {
    const a = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'fr' });
    expect(a.title).toBe('Titre en français');
  });

  it('falls back PER FIELD, so an untranslated field keeps its English text', async () => {
    const en = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'en' });
    const fr = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'fr' });
    expect(fr.title).toBe('Titre en français');
    // description had no French row — it must be English, NOT null and NOT empty.
    expect(fr.description).toBe(en.description);
  });

  it('returns entirely English for an activity with no French row at all', async () => {
    const { rows } = await db.pg.query<{ slug: string }>(
      `select a.slug from activities a
        where a.status = 'published'
          and not exists (select 1 from activity_translations t
                          where t.activity_id = a.id and t.locale = 'fr')
        limit 1`,
    );
    const other = rows[0]!.slug;
    const en = await rpc<Detail>(db, 'api_get_activity', { slug: other, locale: 'en' });
    const fr = await rpc<Detail>(db, 'api_get_activity', { slug: other, locale: 'fr' });
    expect(fr.title).toBe(en.title);
    expect(fr.summary).toBe(en.summary);
  });
});
