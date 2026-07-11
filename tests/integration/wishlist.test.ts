import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { seedOccurrence } from '../db/seed';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';

vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return {
    buildServiceContext: () => mod.requireRouteContext(),
    serviceRoleRpcContext: () => mod.requireRouteContext(),
  };
});

const { GET: wishlistGet, POST: wishlistPost } = await import('../../app/api/v1/wishlist/route');
const { DELETE: wishlistDelete } = await import('../../app/api/v1/wishlist/[slug]/route');

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

async function addRpc(db: TestDb, slug: string) {
  const { rows } = await db.pg.query<{ data: { slug: string; saved: boolean; created: boolean } }>(
    `select api_add_wishlist($1::jsonb) as data`,
    [JSON.stringify({ slug })],
  );
  return rows[0]!.data;
}
async function removeRpc(db: TestDb, slug: string) {
  const { rows } = await db.pg.query<{ data: { slug: string; saved: boolean } }>(
    `select api_remove_wishlist($1::jsonb) as data`,
    [JSON.stringify({ slug })],
  );
  return rows[0]!.data;
}
async function listRpc(
  db: TestDb,
): Promise<Array<{ slug: string; fromPriceEur: number | null; heroImage: unknown }>> {
  const { rows } = await db.pg.query<{
    data: Array<{ slug: string; fromPriceEur: number | null; heroImage: unknown }>;
  }>(`select api_my_wishlist($1::jsonb) as data`, [JSON.stringify({})]);
  return rows[0]!.data;
}
async function countFor(db: TestDb, userId: string): Promise<number> {
  await db.asOwner();
  const { rows } = await db.pg.query<{ n: number }>(
    `select count(*)::int as n from wishlists where user_id = $1`,
    [userId],
  );
  return rows[0]!.n;
}

describe('wishlist', () => {
  let db: TestDb;
  let slugA: string;
  let slugB: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const id of [USER_A, USER_B]) {
      await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [
        id,
        `${id}@example.com`,
      ]);
      await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [id]);
    }
    const seedA = await seedOccurrence(db, 10);
    const seedB = await seedOccurrence(db, 10);
    await db.pg.query(
      `insert into activity_images (activity_id, url, alt, position) values ($1, 'https://img/a.jpg', 'A', 0)`,
      [seedA.activityId],
    );
    slugA = (
      await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [
        seedA.activityId,
      ])
    ).rows[0]!.slug;
    slugB = (
      await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [
        seedB.activityId,
      ])
    ).rows[0]!.slug;

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

  it('adds an activity (saved + created), then re-adds idempotently (no duplicate row)', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const first = await addRpc(db, slugA);
    expect(first).toMatchObject({ slug: slugA, saved: true, created: true });

    const second = await addRpc(db, slugA);
    expect(second).toMatchObject({ slug: slugA, saved: true, created: false });

    expect(await countFor(db, USER_A)).toBe(1);
  });

  it('lists saved activities as full TourSummary cards', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const items = await listRpc(db);
    expect(items).toHaveLength(1);
    expect(items[0]!.slug).toBe(slugA);
    expect(typeof items[0]!.fromPriceEur).toBe('number'); // 7500 / 100 = 75
    expect(items[0]!.heroImage).not.toBeNull();
  });

  it('orders newest-saved first', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    await addRpc(db, slugB);
    const items = await listRpc(db);
    expect(items.map((i) => i.slug)).toEqual([slugB, slugA]);
  });

  it('never leaks another user’s wishlist (ownership isolation)', async () => {
    await db.as({ sub: USER_B, role: 'authenticated' });
    expect(await listRpc(db)).toHaveLength(0);

    await db.as({ sub: USER_B, role: 'authenticated' });
    await addRpc(db, slugA);
    const bItems = await listRpc(db);
    expect(bItems.map((i) => i.slug)).toEqual([slugA]);

    // A's wishlist is untouched.
    expect(await countFor(db, USER_A)).toBe(2);
    expect(await countFor(db, USER_B)).toBe(1);
  });

  it('removes idempotently (saved:false even when not saved)', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    expect(await removeRpc(db, slugA)).toMatchObject({ slug: slugA, saved: false });
    expect((await listRpc(db)).map((i) => i.slug)).toEqual([slugB]);

    // Removing again is a no-op, still saved:false.
    expect(await removeRpc(db, slugA)).toMatchObject({ slug: slugA, saved: false });
    expect((await listRpc(db)).map((i) => i.slug)).toEqual([slugB]);
  });

  it('404s when saving a slug that does not exist (route)', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const res = await wishlistPost(
      new Request('http://localhost/api/v1/wishlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ slug: 'does-not-exist' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('route: POST is 201 (new) then 200 (already saved), with the {slug,saved} envelope', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const make = (body: unknown) =>
      wishlistPost(
        new Request('http://localhost/api/v1/wishlist', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }),
      );
    // slugA was removed earlier, so this is a fresh save → 201.
    const created = await make({ slug: slugA });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ slug: slugA, saved: true });

    const again = await make({ slug: slugA });
    expect(again.status).toBe(200);
  });

  it('route: DELETE removes and is idempotent', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const del = () =>
      wishlistDelete(
        new Request(`http://localhost/api/v1/wishlist/${slugA}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        }),
        { params: Promise.resolve({ slug: slugA }) },
      );
    const first = await del();
    expect(first.status).toBe(200);
    expect((await first.json()).data).toEqual({ slug: slugA, saved: false });
    const second = await del();
    expect(second.status).toBe(200); // idempotent
  });

  it('route: GET returns the {ok,data} envelope (array of TourSummary)', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const res = await wishlistGet(
      new Request('http://localhost/api/v1/wishlist', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('route: 401 without a token (GET, POST, DELETE)', async () => {
    const get = await wishlistGet(new Request('http://localhost/api/v1/wishlist'));
    expect(get.status).toBe(401);
    const post = await wishlistPost(
      new Request('http://localhost/api/v1/wishlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: slugA }),
      }),
    );
    expect(post.status).toBe(401);
    const del = await wishlistDelete(
      new Request(`http://localhost/api/v1/wishlist/${slugA}`, { method: 'DELETE' }),
      { params: Promise.resolve({ slug: slugA }) },
    );
    expect(del.status).toBe(401);
  });

  it('route: 400 on an invalid body (missing slug / unknown key)', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const post = (body: unknown) =>
      wishlistPost(
        new Request('http://localhost/api/v1/wishlist', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }),
      );
    expect((await post({})).status).toBe(400);
    expect((await post({ slug: slugB, extra: 'nope' })).status).toBe(400);
  });
});
