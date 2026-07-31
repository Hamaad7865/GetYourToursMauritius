import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';

/**
 * 20260901000700_translate_content_defaults_and_extra — the last French-localisation gap: the
 * "Know before you go" block on an activity page is fed by TWO untranslated sources,
 * activity_content_defaults (per-category shared copy) and activities.extra (itinerary,
 * whatToBring, importantInfo). Both now resolve PER FIELD against the English row/column, exactly
 * like every other translated field in this catalogue (see localised-catalogue.test.ts).
 */

const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

async function rpc<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

interface ContentDefaultsEntry {
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  whatToBring: string[];
  importantInfo: string[];
}

describe('api_content_defaults resolves per field against the English row', () => {
  let db: TestDb;
  const category = 'Test Category';

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();

    // English baseline: both fields populated.
    await db.pg.query(
      `insert into activity_content_defaults (category, locale, what_to_bring, important_info)
       values ($1, 'en', ARRAY['EN bring']::text[], ARRAY['EN info']::text[])`,
      [category],
    );
    // French row: ONLY important_info translated. what_to_bring left at its column default ('{}'),
    // which must mean "untranslated", not "translated to an empty list".
    await db.pg.query(
      `insert into activity_content_defaults (category, locale, important_info)
       values ($1, 'fr', ARRAY['FR info']::text[])`,
      [category],
    );
  });

  afterAll(async () => {
    await db.close?.();
  });

  it('returns English when no locale is supplied', async () => {
    const d = await rpc<Record<string, ContentDefaultsEntry>>(db, 'api_content_defaults', {});
    expect(d[category]!.importantInfo).toEqual(['EN info']);
    expect(d[category]!.whatToBring).toEqual(['EN bring']);
  });

  it('returns the French importantInfo when locale is fr', async () => {
    const d = await rpc<Record<string, ContentDefaultsEntry>>(db, 'api_content_defaults', {
      locale: 'fr',
    });
    expect(d[category]!.importantInfo).toEqual(['FR info']);
  });

  it('falls back PER FIELD: the untranslated whatToBring stays English, not empty', async () => {
    const d = await rpc<Record<string, ContentDefaultsEntry>>(db, 'api_content_defaults', {
      locale: 'fr',
    });
    // The bug this per-field nullif(...,'{}') guards against: a plain coalesce would see the fr
    // row's what_to_bring ('{}', the column default) as "present" and render an empty list instead
    // of falling back to English.
    expect(d[category]!.whatToBring).toEqual(['EN bring']);
    expect(d[category]!.whatToBring).not.toEqual([]);
  });

  it('an absent locale key behaves exactly like locale: en (self-join, no-op coalesce)', async () => {
    const noLocale = await rpc<Record<string, ContentDefaultsEntry>>(
      db,
      'api_content_defaults',
      {},
    );
    const enLocale = await rpc<Record<string, ContentDefaultsEntry>>(db, 'api_content_defaults', {
      locale: 'en',
    });
    expect(noLocale[category]).toEqual(enLocale[category]);
  });
});

interface Detail {
  slug: string;
  extra: {
    itinerary?: { title: string; description: string | null }[];
    importantInfo?: string[];
    whatToBring?: string[];
    availability?: string | null;
    adultsOnly?: boolean;
  };
}

describe('api_get_activity merges extra per key (a.extra || t.extra)', () => {
  let db: TestDb;
  let slug: string;
  let activityId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));

    const { rows } = await db.pg.query<{ id: string; slug: string }>(
      `select id, slug from activities where status = 'published' order by slug limit 1`,
    );
    activityId = rows[0]!.id;
    slug = rows[0]!.slug;

    // English `extra`: itinerary + importantInfo + a couple of OPERATIONAL flags that must never be
    // affected by a translation row (availability, adultsOnly).
    await db.pg.query(`update activities set extra = $2::jsonb where id = $1`, [
      activityId,
      JSON.stringify({
        itinerary: [{ title: 'Grand Baie', description: 'Departure' }],
        importantInfo: ['English important info'],
        whatToBring: ['English bring'],
        availability: 'daily',
        adultsOnly: true,
      }),
    ]);

    // French translation row's `extra`: ONLY importantInfo. itinerary/whatToBring/availability/
    // adultsOnly must NOT appear here — they come from the English `activities.extra` column.
    await db.pg.query(
      `insert into activity_translations (activity_id, locale, source, extra)
       values ($1, 'fr', 'human', $2::jsonb)
       on conflict (activity_id, locale) do update set extra = excluded.extra`,
      [activityId, JSON.stringify({ importantInfo: ['Informations importantes en français'] })],
    );
  });

  afterAll(async () => {
    await db.close?.();
  });

  it('returns English extra when no locale is supplied', async () => {
    const a = await rpc<Detail>(db, 'api_get_activity', { slug });
    expect(a.extra.importantInfo).toEqual(['English important info']);
  });

  it('returns the French importantInfo when locale is fr', async () => {
    const a = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'fr' });
    expect(a.extra.importantInfo).toEqual(['Informations importantes en français']);
  });

  it('leaves itinerary English — the French extra never defined that key', async () => {
    const en = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'en' });
    const fr = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'fr' });
    expect(fr.extra.itinerary).toEqual(en.extra.itinerary);
    expect(fr.extra.itinerary).toEqual([{ title: 'Grand Baie', description: 'Departure' }]);
  });

  it('leaves whatToBring English too — only importantInfo was translated', async () => {
    const fr = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'fr' });
    expect(fr.extra.whatToBring).toEqual(['English bring']);
  });

  it('preserves operational, non-content flags exactly (availability, adultsOnly)', async () => {
    const en = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'en' });
    const fr = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'fr' });
    expect(fr.extra.availability).toBe('daily');
    expect(fr.extra.adultsOnly).toBe(true);
    expect(fr.extra.availability).toBe(en.extra.availability);
    expect(fr.extra.adultsOnly).toBe(en.extra.adultsOnly);
  });

  it('returns entirely English extra for an activity whose French row has no extra at all', async () => {
    const { rows } = await db.pg.query<{ slug: string }>(
      `select a.slug from activities a
        where a.status = 'published' and a.id <> $1
        order by a.slug limit 1`,
      [activityId],
    );
    const other = rows[0]!.slug;
    const en = await rpc<Detail>(db, 'api_get_activity', { slug: other, locale: 'en' });
    const fr = await rpc<Detail>(db, 'api_get_activity', { slug: other, locale: 'fr' });
    expect(fr.extra).toEqual(en.extra);
  });
});
