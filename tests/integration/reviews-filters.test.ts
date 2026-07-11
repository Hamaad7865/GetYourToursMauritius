import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';

vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return {
    buildServiceContext: () => mod.requireRouteContext(),
    serviceRoleRpcContext: () => mod.requireRouteContext(),
  };
});

const { POST: reviewPost } = await import('../../app/api/v1/activities/[slug]/reviews/route');
const { GET: myReviewsGet } = await import('../../app/api/v1/account/reviews/route');
const { GET: facetsGet } = await import('../../app/api/v1/activities/facets/route');
const { GET: categoriesGet } = await import('../../app/api/v1/categories/route');

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-must-be-long-enough-1234567890';

async function mintToken(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}
async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}
function reviewReq(
  slug: string,
  token: string | null,
  body: unknown,
): [Request, { params: Promise<{ slug: string }> }] {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return [
    new Request(`http://localhost/api/v1/activities/${slug}/reviews`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  ];
}

describe('reviews + filters', () => {
  let db: TestDb;
  let operatorId: string;
  let reviewOptId: string;
  let reviewOccId: string;

  async function makeActivity(opts: {
    slug: string;
    priceMinor: number | null;
    duration: number | null;
    ratingAvg: number | null;
    ratingCount: number;
    category?: string;
  }): Promise<{ id: string; optId: string }> {
    const act = await db.pg.query<{ id: string }>(
      `insert into activities (operator_id, slug, title, category, status, pricing_mode, duration_minutes, rating_avg, rating_count)
       values ($1, $2, $3, $4, 'published', 'per_person', $5, $6, $7) returning id`,
      [
        operatorId,
        opts.slug,
        opts.slug,
        opts.category ?? 'Catamaran cruises',
        opts.duration,
        opts.ratingAvg,
        opts.ratingCount,
      ],
    );
    const opt = await db.pg.query<{ id: string }>(
      `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
      [act.rows[0]!.id],
    );
    if (opts.priceMinor != null) {
      await db.pg.query(
        `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', $2)`,
        [opt.rows[0]!.id, opts.priceMinor],
      );
    }
    return { id: act.rows[0]!.id, optId: opt.rows[0]!.id };
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const id of [USER_A, USER_B]) {
      await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [
        id,
        `${id}@example.com`,
      ]);
      await db.pg.query(`insert into profiles (id, role, full_name) values ($1, 'customer', $2)`, [
        id,
        `User ${id.slice(0, 4)}`,
      ]);
    }
    operatorId = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Op', 'op') returning id`,
      )
    ).rows[0]!.id;

    // Reviewable activity + a confirmed booking for USER_A (the booking gate).
    const rev = await makeActivity({
      slug: 'reviewable',
      priceMinor: 7500,
      duration: 90,
      ratingAvg: null,
      ratingCount: 0,
    });
    reviewOptId = rev.optId;
    reviewOccId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '2 days', now() + interval '2 days 3 hours', 20) returning id`,
        [reviewOptId, operatorId],
      )
    ).rows[0]!.id;
    const booking = await db.pg.query<{ id: string }>(
      `insert into bookings (user_id, customer_name, customer_email, total_minor, status)
       values ($1, 'A', 'a@example.com', 7500, 'confirmed') returning id`,
      [USER_A],
    );
    await db.pg.query(
      `insert into booking_items (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 1, 7500, 7500)`,
      [booking.rows[0]!.id, reviewOccId, reviewOptId],
    );

    // Filter activities: cheap/mid/pricey with distinct price/duration/rating.
    await makeActivity({
      slug: 'cheap',
      priceMinor: 5000,
      duration: 60,
      ratingAvg: 3.0,
      ratingCount: 4,
    });
    await makeActivity({
      slug: 'mid',
      priceMinor: 10000,
      duration: 120,
      ratingAvg: 4.5,
      ratingCount: 9,
    });
    await makeActivity({
      slug: 'pricey',
      priceMinor: 20000,
      duration: 240,
      ratingAvg: 5.0,
      ratingCount: 2,
    });
    // Published but with NO price rows + null duration (ignored by facet min/max) — must drop out of any
    // price-bounded query rather than slip in as a €0 row.
    await makeActivity({
      slug: 'freebie',
      priceMinor: null,
      duration: null,
      ratingAvg: null,
      ratingCount: 0,
    });

    await db.pg.query(
      `insert into categories (name, slug, position, status) values ('Cruises', 'cruises', 1, 'active')`,
    );
    await db.pg.query(
      `insert into categories (name, slug, position, status) values ('Hidden', 'hidden', 2, 'hidden')`,
    );

    setRouteContext({
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    });
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  // ---- reviews ----
  it('rejects a review from a user without a confirmed booking (403)', async () => {
    await db.as({ sub: USER_B, role: 'authenticated' });
    const res = await reviewPost(
      ...reviewReq('reviewable', await mintToken(USER_B), { rating: 5 }),
    );
    expect(res.status).toBe(403);
  });

  it('404 for an unknown activity slug; 400 for a bad rating', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const missing = await reviewPost(...reviewReq('nope', token, { rating: 5 }));
    expect(missing.status).toBe(404);
    const bad = await reviewPost(...reviewReq('reviewable', token, { rating: 9 }));
    expect(bad.status).toBe(400);
  });

  it('accepts a booking-gated review (201) and recomputes the rating', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const res = await reviewPost(
      ...reviewReq('reviewable', await mintToken(USER_A), { rating: 4, text: 'Lovely' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ rating: 4, text: 'Lovely', author: expect.any(String) });

    await db.asOwner();
    const agg = await db.pg.query<{ rating_avg: string; rating_count: number }>(
      `select rating_avg, rating_count from activities where slug = 'reviewable'`,
    );
    expect(Number(agg.rows[0]!.rating_avg)).toBe(4);
    expect(agg.rows[0]!.rating_count).toBe(1);
  });

  it('upserts one review per user (re-submit updates, does not duplicate)', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const res = await reviewPost(
      ...reviewReq('reviewable', await mintToken(USER_A), { rating: 2, text: 'Changed my mind' }),
    );
    expect(res.status).toBe(201);
    await db.asOwner();
    const rows = await db.pg.query<{ n: number }>(
      `select count(*)::int n from reviews r join activities a on a.id = r.activity_id where a.slug = 'reviewable' and r.user_id = $1`,
      [USER_A],
    );
    expect(rows.rows[0]!.n).toBe(1); // still one row
    const agg = await db.pg.query<{ rating_avg: string }>(
      `select rating_avg from activities where slug = 'reviewable'`,
    );
    expect(Number(agg.rows[0]!.rating_avg)).toBe(2);
  });

  it('blocks direct review inserts (RLS) — only the booking-gated RPC may write', async () => {
    // USER_A even has a confirmed booking, but a direct PostgREST-style insert must still be denied:
    // the booking gate lives only in api_submit_review, so the table has no permissive insert policy.
    await db.as({ sub: USER_A, role: 'authenticated' });
    const actId = (
      await db.pg.query<{ id: string }>(`select id from activities where slug = 'reviewable'`)
    ).rows[0]!.id;
    await expect(
      db.pg.query(
        `insert into reviews (activity_id, user_id, author, rating, text) values ($1, $2, 'Hacker', 5, 'forged')`,
        [actId, USER_A],
      ),
    ).rejects.toThrow();
  });

  it('My reviews is owner-scoped', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const a = await myReviewsGet(
      new Request('http://localhost/api/v1/account/reviews', {
        headers: { authorization: `Bearer ${await mintToken(USER_A)}` },
      }),
    );
    expect(a.status).toBe(200);
    const aBody = await a.json();
    expect(aBody.data).toHaveLength(1);
    expect(aBody.data[0]).toMatchObject({
      activitySlug: 'reviewable',
      activityTitle: 'reviewable',
      rating: 2,
    });

    await db.as({ sub: USER_B, role: 'authenticated' });
    const b = await myReviewsGet(
      new Request('http://localhost/api/v1/account/reviews', {
        headers: { authorization: `Bearer ${await mintToken(USER_B)}` },
      }),
    );
    expect((await b.json()).data).toHaveLength(0);

    const anon = await myReviewsGet(new Request('http://localhost/api/v1/account/reviews'));
    expect(anon.status).toBe(401);
  });

  // ---- filters ----
  it('filters activities by price / duration / rating', async () => {
    await db.as(null);
    const slugs = async (params: Record<string, unknown>) =>
      (
        await call<{ items: Array<{ slug: string }> }>(db, 'api_search_activities', {
          page: 1,
          pageSize: 50,
          ...params,
        })
      ).items
        .map((i) => i.slug)
        .filter((s) => ['cheap', 'mid', 'pricey'].includes(s));

    expect((await slugs({ priceMin: 80 })).sort()).toEqual(['mid', 'pricey']); // ≥ €80
    expect((await slugs({ priceMax: 80 })).sort()).toEqual(['cheap']); // ≤ €80
    expect((await slugs({ priceMin: 80, priceMax: 150 })).sort()).toEqual(['mid']);
    expect((await slugs({ durationMin: 100 })).sort()).toEqual(['mid', 'pricey']);
    expect((await slugs({ durationMax: 90 })).sort()).toEqual(['cheap']);
    expect((await slugs({ minRating: 4 })).sort()).toEqual(['mid', 'pricey']);
  });

  it('excludes unpriced activities from price-bounded results (not coalesced to €0)', async () => {
    await db.as(null);
    const present = async (params: Record<string, unknown>) =>
      (
        await call<{ items: Array<{ slug: string }> }>(db, 'api_search_activities', {
          page: 1,
          pageSize: 50,
          ...params,
        })
      ).items.some((i) => i.slug === 'freebie');
    expect(await present({})).toBe(true); // no price filter → shown
    expect(await present({ priceMax: 1000 })).toBe(false); // would have slipped in as €0 before the fix
    expect(await present({ priceMin: 0 })).toBe(false); // a price bound excludes an unpriced row
  });

  it('facets returns the price/duration bounds (route)', async () => {
    const res = await facetsGet(new Request('http://localhost/api/v1/activities/facets'));
    expect(res.status).toBe(200);
    const facets = (await res.json()).data;
    expect(facets.priceMinEur).toBe(50);
    expect(facets.priceMaxEur).toBe(200);
    expect(facets.durationMin).toBe(60);
    expect(facets.durationMax).toBe(240);
  });

  it('categories returns active only (route)', async () => {
    const res = await categoriesGet(new Request('http://localhost/api/v1/categories'));
    expect(res.status).toBe(200);
    const cats = (await res.json()).data as Array<{ slug: string }>;
    expect(cats.some((c) => c.slug === 'cruises')).toBe(true);
    expect(cats.some((c) => c.slug === 'hidden')).toBe(false);
  });
});
