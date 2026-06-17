import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Integration: the admin "add activity" path → the public website read path.
 *
 * The admin form (src/lib/admin/activity-write.ts) inserts an activity + images +
 * options + price tiers + itinerary (extra) DIRECTLY through the authenticated client,
 * gated by the staff RLS policies. This test reproduces those exact inserts AS A STAFF
 * USER (so RLS is exercised), then reads the result back through the same RPCs the site
 * uses — api_search_activities (home/browse cards) and api_get_activity (detail page) —
 * AS THE ANONYMOUS PUBLIC, proving an admin-created activity shows up correctly.
 */
const STAFF = 'a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5';

async function rpc<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

interface DetailDto {
  title: string;
  description: string | null;
  images: unknown[];
  options: Array<{ name: string; prices: Array<{ label: string; amountEur: number; maxGuests: number | null }> }>;
  extra: { itinerary?: Array<{ title: string; area: string | null; tags: string[] }> };
}

describe('admin add-activity → website read', () => {
  let db: TestDb;
  let operatorId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`);
    operatorId = (
      await db.pg.query<{ id: string }>(`select id from operators where slug = 'belle-mare-tours'`)
    ).rows[0]!.id;
    // An admin account, so the staff RLS policies grant the writes below.
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [STAFF]);
  });

  afterAll(async () => {
    await db.close();
  });

  /** Mirrors activity-write.ts: activity + images + one option with a price tier + itinerary. */
  async function addActivityAsAdmin(opts: { slug: string; status: 'published' | 'draft'; withChildren?: boolean }) {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const extra = JSON.stringify({
      itinerary: [{ title: 'Port Louis', area: 'Capital', description: 'Central market', tags: ['city', 'market'] }],
    });
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into activities
         (operator_id, slug, type, title, summary, description, category, location, duration_minutes,
          meeting_point, pickup_available, languages, inclusions, exclusions, highlights,
          cancellation_policy, status, extra)
       values ($1, $2, 'activity', 'Admin North Demo', 'A day in the north', 'A full guided day.',
          'Sightseeing tours', 'North', 300, 'Hotel lobby', true,
          '{English,French}', '{Lunch,Guide}', '{Tips}', '{Scenic stops}',
          'Free cancellation up to 24 hours before.', $3, $4::jsonb)
       returning id`,
      [operatorId, opts.slug, opts.status, extra],
    );
    const activityId = rows[0]!.id;
    if (opts.withChildren) {
      await db.pg.query(
        `insert into activity_images (activity_id, url, alt, position)
         values ($1, 'https://img/cover.jpg', 'Cover', 0), ($1, 'https://img/two.jpg', 'Two', 1)`,
        [activityId],
      );
      const option = (
        await db.pg.query<{ id: string }>(
          `insert into activity_options (activity_id, name, position) values ($1, 'Private group', 0) returning id`,
          [activityId],
        )
      ).rows[0]!.id;
      await db.pg.query(
        `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests, position)
         values ($1, 'Up to 4 people', 7000, 4, 0)`,
        [option],
      );
    }
    return activityId;
  }

  it('a published admin activity appears in the catalogue with its photos, options and itinerary', async () => {
    await addActivityAsAdmin({ slug: 'admin-north-demo', status: 'published', withChildren: true });

    // Read as the public website.
    await db.as(null);
    const search = await rpc<{
      items: Array<{
        slug: string;
        title: string;
        category: string;
        fromPriceEur: number;
        heroImage: { url: string } | null;
        images: unknown[];
      }>;
    }>(db, 'api_search_activities', { pageSize: 100 });

    const card = search.items.find((i) => i.slug === 'admin-north-demo');
    expect(card, 'admin activity should appear on the home/browse cards').toBeTruthy();
    expect(card!.title).toBe('Admin North Demo');
    expect(card!.category).toBe('Sightseeing tours');
    expect(card!.fromPriceEur).toBe(70);
    expect(card!.heroImage?.url).toBe('https://img/cover.jpg');
    expect(card!.images).toHaveLength(2);

    const detail = await rpc<DetailDto>(db, 'api_get_activity', { slug: 'admin-north-demo' });
    expect(detail.title).toBe('Admin North Demo');
    expect(detail.description).toBe('A full guided day.');
    expect(detail.images).toHaveLength(2);
    expect(detail.options).toHaveLength(1);
    expect(detail.options[0]!.prices[0]!.amountEur).toBe(70);
    expect(detail.options[0]!.prices[0]!.maxGuests).toBe(4);
    expect(detail.extra.itinerary?.[0]?.title).toBe('Port Louis');
    expect(detail.extra.itinerary?.[0]?.tags).toEqual(['city', 'market']);
  });

  it('a draft admin activity stays hidden from the public website', async () => {
    await addActivityAsAdmin({ slug: 'admin-draft-demo', status: 'draft' });

    await db.as(null);
    const search = await rpc<{ items: Array<{ slug: string }> }>(db, 'api_search_activities', { pageSize: 100 });
    expect(search.items.find((i) => i.slug === 'admin-draft-demo'), 'draft must not appear publicly').toBeFalsy();

    const detail = await rpc<DetailDto | null>(db, 'api_get_activity', { slug: 'admin-draft-demo' });
    expect(detail, 'draft detail must be hidden from anon').toBeFalsy();
  });

  it('editing the activity (changing price + republishing) is reflected on the site', async () => {
    // Admin lowers the price and updates the title — mirrors updateActivity's replace.
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`update activities set title = 'Admin North Demo (Updated)' where slug = 'admin-north-demo'`);
    await db.pg.query(
      `update activity_option_prices set amount_minor = 6000
       where activity_option_id in (
         select o.id from activity_options o join activities a on a.id = o.activity_id
         where a.slug = 'admin-north-demo'
       )`,
    );

    await db.as(null);
    const detail = await rpc<DetailDto>(db, 'api_get_activity', { slug: 'admin-north-demo' });
    expect(detail.title).toBe('Admin North Demo (Updated)');
    expect(detail.options[0]!.prices[0]!.amountEur).toBe(60);
  });
});
