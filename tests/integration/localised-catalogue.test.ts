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
    await db.pg.query(
      `delete from activity_translations where activity_id = $1 and locale = 'fr'`,
      [rows[1]!.id],
    );
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

  it('returns French titles in search results, not just on the detail page', async () => {
    const res = await rpc<{ items: { slug: string; title: string }[] }>(
      db,
      'api_search_activities',
      {
        q: null,
        category: null,
        type: null,
        region: null,
        priceMin: null,
        priceMax: null,
        durationMin: null,
        durationMax: null,
        minRating: null,
        page: 1,
        pageSize: 100,
        locale: 'fr',
      },
    );
    const hit = res.items.find((i) => i.slug === slug);
    expect(hit?.title).toBe('Titre en français');
  });

  it('leaves search results English by default', async () => {
    const res = await rpc<{ items: { slug: string; title: string }[] }>(
      db,
      'api_search_activities',
      {
        q: null,
        category: null,
        type: null,
        region: null,
        priceMin: null,
        priceMax: null,
        durationMin: null,
        durationMax: null,
        minRating: null,
        page: 1,
        pageSize: 100,
      },
    );
    expect(res.items.find((i) => i.slug === slug)?.title).not.toBe('Titre en français');
  });

  it('falls back per field in search results too', async () => {
    // The partial fixture has a French title but NO French summary — the summary must stay English
    // rather than coming back null and rendering a card with a blank line.
    const en = await rpc<{ items: { slug: string; summary: string | null }[] }>(
      db,
      'api_search_activities',
      {
        q: null,
        category: null,
        type: null,
        region: null,
        priceMin: null,
        priceMax: null,
        durationMin: null,
        durationMax: null,
        minRating: null,
        page: 1,
        pageSize: 100,
      },
    );
    const fr = await rpc<{ items: { slug: string; summary: string | null }[] }>(
      db,
      'api_search_activities',
      {
        q: null,
        category: null,
        type: null,
        region: null,
        priceMin: null,
        priceMax: null,
        durationMin: null,
        durationMax: null,
        minRating: null,
        page: 1,
        pageSize: 100,
        locale: 'fr',
      },
    );
    const enHit = en.items.find((i) => i.slug === slug);
    const frHit = fr.items.find((i) => i.slug === slug);
    expect(frHit?.summary).toBe(enHit?.summary);
  });

  it('does not change the result count when joining translations', async () => {
    // Guard against the join fanning out rows. activity_translations is unique on
    // (activity_id, locale), so a correct join cannot duplicate — but a missing locale predicate
    // in the ON clause would silently multiply every activity by its number of translations.
    const en = await rpc<{ total: number; items: unknown[] }>(db, 'api_search_activities', {
      q: null,
      category: null,
      type: null,
      region: null,
      priceMin: null,
      priceMax: null,
      durationMin: null,
      durationMax: null,
      minRating: null,
      page: 1,
      pageSize: 100,
    });
    const fr = await rpc<{ total: number; items: unknown[] }>(db, 'api_search_activities', {
      q: null,
      category: null,
      type: null,
      region: null,
      priceMin: null,
      priceMax: null,
      durationMin: null,
      durationMax: null,
      minRating: null,
      page: 1,
      pageSize: 100,
      locale: 'fr',
    });
    expect(fr.total).toBe(en.total);
    expect(fr.items.length).toBe(en.items.length);
  });

  it('finds an activity by its FRENCH title', async () => {
    // The whole point of translating: a French visitor sees "Titre en français" on the card, types
    // part of it, and must get the activity back. Matching only English columns returns nothing.
    const res = await rpc<{ items: { slug: string }[] }>(db, 'api_search_activities', {
      q: 'français',
      category: null,
      type: null,
      region: null,
      priceMin: null,
      priceMax: null,
      durationMin: null,
      durationMax: null,
      minRating: null,
      page: 1,
      pageSize: 100,
      locale: 'fr',
    });
    expect(res.items.map((i) => i.slug)).toContain(slug);
  });

  it('still finds an activity by its ENGLISH title while browsing in French', async () => {
    // Place names and brand terms are shared across languages, so an English query must keep
    // working in a French session.
    const { rows } = await db.pg.query<{ title: string }>(
      `select title from activities where slug = $1`,
      [slug],
    );
    const word = rows[0]!.title.split(' ')[0]!;
    const res = await rpc<{ items: { slug: string }[] }>(db, 'api_search_activities', {
      q: word,
      category: null,
      type: null,
      region: null,
      priceMin: null,
      priceMax: null,
      durationMin: null,
      durationMax: null,
      minRating: null,
      page: 1,
      pageSize: 100,
      locale: 'fr',
    });
    expect(res.items.map((i) => i.slug)).toContain(slug);
  });

  it('matches the French title even for an English session', async () => {
    const res = await rpc<{ items: { slug: string }[] }>(db, 'api_search_activities', {
      q: 'français',
      category: null,
      type: null,
      region: null,
      priceMin: null,
      priceMax: null,
      durationMin: null,
      durationMax: null,
      minRating: null,
      page: 1,
      pageSize: 100,
    });
    expect(res.items.map((i) => i.slug)).toContain(slug);
  });

  it('does not duplicate a row that matches in BOTH languages', async () => {
    // An activity whose English and French text both match the query must appear ONCE. An OR
    // across joined columns is safe, but a careless join or a UNION would double it.
    const res = await rpc<{ items: { slug: string }[]; total: number }>(
      db,
      'api_search_activities',
      {
        q: 'a',
        category: null,
        type: null,
        region: null,
        priceMin: null,
        priceMax: null,
        durationMin: null,
        durationMax: null,
        minRating: null,
        page: 1,
        pageSize: 100,
        locale: 'fr',
      },
    );
    const slugs = res.items.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(res.total).toBe(slugs.length);
  });
});
