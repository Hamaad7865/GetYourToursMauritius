import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * The SEO module's security boundary: the restricted 'seo' role can manage CONTENT
 * (seo_meta / posts / seo_redirects, plus activity copy) but is locked out of customer data and
 * money config by RLS — that separation is the whole reason the role exists (an external SEO hire
 * must never see bookings/PII). Also proves the public read RPCs: published-only posts for anon,
 * meta overrides, and redirect lookup.
 */

const SEO_USER = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const CUSTOMER = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('seo module: restricted role + content tables + public RPCs', () => {
  let db: TestDb;
  let activityId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [SEO_USER, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'seo'), ($2, 'customer')`, [
      SEO_USER,
      CUSTOMER,
    ]);
    activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode)
         values ($1, 'seo-test-tour', 'activity', 'SEO Test Tour', 'Sightseeing tours', 'published', 'per_person')
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    // A booking + a lead the seo role must NOT be able to read.
    await db.pg.query(
      `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency)
       values ('BMT-SEO-1', 'confirmed', 'Secret Customer', 'secret@example.com', 5000, 'EUR')`,
    );
    await db.pg.query(
      `insert into leads (name, contact) values ('Secret Lead', 'lead@example.com')`,
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('seo role writes the three content tables', async () => {
    await db.as({ sub: SEO_USER, role: 'authenticated' });
    await db.pg.query(
      `insert into seo_meta (path, title, description) values ('/rent', 'Rental — SEO title', 'SEO description')`,
    );
    await db.pg.query(
      `insert into posts (slug, title, status, published_at, sections, hero_image_url)
       values ('seo-written-post', 'A post by the SEO editor', 'published', '2026-07-01',
               '[{"heading":"Intro","paragraphs":["Hello"],"imageUrl":"https://cdn.example/section.jpg"}]',
               'https://cdn.example/hero.jpg'),
              ('seo-draft-post', 'A draft', 'draft', null, '[]', null)`,
    );
    await db.pg.query(
      `insert into seo_redirects (from_path, to_path) values ('/old-tour', '/mauritius-tours')`,
    );
    const n = (await db.pg.query<{ c: number }>(`select count(*)::int as c from seo_meta`))
      .rows[0]!;
    expect(n.c).toBe(1);
  });

  it('seo role edits activity CONTENT but cannot touch price tiers', async () => {
    await db.as({ sub: SEO_USER, role: 'authenticated' });
    await db.pg.query(`update activities set summary = 'Rewritten by SEO' where id = $1`, [
      activityId,
    ]);
    const row = (
      await db.pg.query<{ summary: string }>(`select summary from activities where id = $1`, [
        activityId,
      ])
    ).rows[0]!;
    expect(row.summary).toBe('Rewritten by SEO');

    // Pricing is out of bounds: activity_options has no content-editor policy → RLS refuses the write.
    await expect(
      db.pg.query(`insert into activity_options (activity_id, name) values ($1, 'Hacked option')`, [
        activityId,
      ]),
    ).rejects.toThrow();
  });

  it('seo role CANNOT read bookings or leads (RLS keeps PII out of reach)', async () => {
    await db.as({ sub: SEO_USER, role: 'authenticated' });
    const bookings = await db.pg.query(`select * from bookings`);
    expect(bookings.rows).toHaveLength(0);
    const leads = await db.pg.query(`select * from leads`);
    expect(leads.rows).toHaveLength(0);
  });

  it('customers cannot write the content tables', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      db.pg.query(`insert into seo_meta (path, title) values ('/hacked', 'nope')`),
    ).rejects.toThrow();
    await expect(
      db.pg.query(`insert into seo_redirects (from_path, to_path) values ('/a', '/b')`),
    ).rejects.toThrow();
  });

  it('anon sees published posts only — drafts stay hidden', async () => {
    await db.as(null);
    const list = await call<Array<{ slug: string }>>(db, 'api_list_posts', {});
    expect(list.map((p) => p.slug)).toEqual(['seo-written-post']);
    const draft = await call(db, 'api_get_post', { slug: 'seo-draft-post' });
    expect(draft).toBeNull();
    const published = await call<{
      slug: string;
      sections: Array<{ imageUrl?: string }>;
      heroImageUrl: string | null;
    }>(db, 'api_get_post', { slug: 'seo-written-post' });
    expect(published.slug).toBe('seo-written-post');
    expect(published.sections).toHaveLength(1);
    // Photos round-trip: the cover + a per-section image survive the RPC DTO.
    expect(published.heroImageUrl).toBe('https://cdn.example/hero.jpg');
    expect(published.sections[0]?.imageUrl).toBe('https://cdn.example/section.jpg');
    // Direct table read agrees with the RPC (RLS, not just the function, hides drafts).
    const direct = await db.pg.query(`select slug from posts`);
    expect(direct.rows).toHaveLength(1);
  });

  it('api_seo_meta returns the override (and null for an untouched path)', async () => {
    await db.as(null);
    const meta = await call<{ title: string; description: string }>(db, 'api_seo_meta', {
      path: '/rent',
    });
    expect(meta.title).toBe('Rental — SEO title');
    const none = await call(db, 'api_seo_meta', { path: '/never-touched' });
    expect(none).toBeNull();
  });

  it('api_lookup_redirect resolves a missed path (and null otherwise)', async () => {
    await db.as(null);
    const to = await call<string>(db, 'api_lookup_redirect', { path: '/old-tour' });
    expect(to).toBe('/mauritius-tours');
    const none = await call(db, 'api_lookup_redirect', { path: '/not-redirected' });
    expect(none).toBeNull();
  });
});
