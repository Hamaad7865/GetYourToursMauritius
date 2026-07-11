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

const { GET: notificationsGet } = await import('../../app/api/v1/notifications/route');
const { POST: readPost } = await import('../../app/api/v1/notifications/[id]/read/route');
const { POST: readAllPost } = await import('../../app/api/v1/notifications/read-all/route');
const { GET: unreadCountGet } = await import('../../app/api/v1/notifications/unread-count/route');

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const MISSING_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-must-be-long-enough-1234567890';

async function mintToken(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

interface Feed {
  items: Array<{ id: string; type: string; title: string; readAt: string | null }>;
  total: number;
}
async function listRpc(db: TestDb, params: Record<string, unknown> = {}): Promise<Feed> {
  const { rows } = await db.pg.query<{ data: Feed }>(
    `select api_my_notifications($1::jsonb) as data`,
    [JSON.stringify(params)],
  );
  return rows[0]!.data;
}

describe('notifications feed', () => {
  let db: TestDb;
  const id: Record<string, string> = {};

  async function seedNote(
    userId: string,
    key: string,
    opts: { type: string; createdAt: string; read?: boolean },
  ): Promise<void> {
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into notifications (user_id, type, title, body, data, created_at, read_at)
       values ($1, $2, 'Title', 'Body', jsonb_build_object('ref','X'), $3, $4) returning id`,
      [userId, opts.type, opts.createdAt, opts.read ? new Date().toISOString() : null],
    );
    id[key] = rows[0]!.id;
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const uid of [USER_A, USER_B, USER_C]) {
      await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [
        uid,
        `${uid}@example.com`,
      ]);
      await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [uid]);
    }
    // USER_A: a1 (read, oldest), a2 (unread), a3 (unread, newest).
    await seedNote(USER_A, 'a1', {
      type: 'booking_confirmed',
      createdAt: '2026-01-01T00:00:00Z',
      read: true,
    });
    await seedNote(USER_A, 'a2', { type: 'booking_refunded', createdAt: '2026-02-01T00:00:00Z' });
    await seedNote(USER_A, 'a3', { type: 'booking_cancelled', createdAt: '2026-03-01T00:00:00Z' });
    await seedNote(USER_B, 'b1', { type: 'booking_confirmed', createdAt: '2026-02-15T00:00:00Z' });

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

  it('generates an owner-scoped feed row when a booking is confirmed (idempotently)', async () => {
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into bookings (user_id, customer_name, customer_email, total_minor, status)
       values ($1, 'C', 'c@example.com', 11000, 'payment_pending') returning id`,
      [USER_C],
    );
    const bookingId = rows[0]!.id;
    // payment_pending -> confirmed fires the lifecycle trigger.
    await db.pg.query(`update bookings set status = 'confirmed' where id = $1`, [bookingId]);
    // Re-entering the confirmed branch (completed -> confirmed) must NOT post a duplicate.
    await db.pg.query(`update bookings set status = 'completed' where id = $1`, [bookingId]);
    await db.pg.query(`update bookings set status = 'confirmed' where id = $1`, [bookingId]);

    const { rows: feed } = await db.pg.query<{ title: string; read_at: string | null }>(
      `select title, read_at from notifications
        where user_id = $1 and type = 'booking_confirmed' and data ->> 'bookingId' = $2`,
      [USER_C, bookingId],
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]!.title).toBe('Booking confirmed');
    expect(feed[0]!.read_at).toBeNull();
  });

  it('lists the caller’s notifications newest-first', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const data = await listRpc(db);
    expect(data.total).toBe(3);
    expect(data.items.map((n) => n.id)).toEqual([id.a3, id.a2, id.a1]);
  });

  it('filters with unreadOnly', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const data = await listRpc(db, { unreadOnly: true });
    expect(data.total).toBe(2);
    expect(data.items.map((n) => n.id)).toEqual([id.a3, id.a2]); // a1 is read
  });

  it('paginates (page / pageSize) with a stable total', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const page1 = await listRpc(db, { page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.items.map((n) => n.id)).toEqual([id.a3, id.a2]);
    const page2 = await listRpc(db, { page: 2, pageSize: 2 });
    expect(page2.items.map((n) => n.id)).toEqual([id.a1]);
  });

  it('never leaks another user’s notifications (ownership isolation)', async () => {
    await db.as({ sub: USER_B, role: 'authenticated' });
    const data = await listRpc(db);
    expect(data.total).toBe(1);
    expect(data.items.map((n) => n.id)).toEqual([id.b1]);
  });

  it('marks one read (idempotent — same readAt on a second call)', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const { rows: first } = await db.pg.query<{ data: { id: string; readAt: string } }>(
      `select api_mark_notification_read($1::jsonb) as data`,
      [JSON.stringify({ id: id.a2 })],
    );
    expect(first[0]!.data.readAt).toBeTruthy();
    const { rows: second } = await db.pg.query<{ data: { id: string; readAt: string } }>(
      `select api_mark_notification_read($1::jsonb) as data`,
      [JSON.stringify({ id: id.a2 })],
    );
    expect(second[0]!.data.readAt).toBe(first[0]!.data.readAt); // unchanged
  });

  it('route: 403 marking someone else’s notification, 404 when missing', async () => {
    // USER_B cannot mark USER_A's a1.
    await db.as({ sub: USER_B, role: 'authenticated' });
    const tokenB = await mintToken(USER_B);
    const forbidden = await readPost(
      new Request(`http://localhost/api/v1/notifications/${id.a1}/read`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenB}` },
      }),
      { params: Promise.resolve({ id: id.a1! }) },
    );
    expect(forbidden.status).toBe(403);

    await db.as({ sub: USER_A, role: 'authenticated' });
    const tokenA = await mintToken(USER_A);
    const missing = await readPost(
      new Request(`http://localhost/api/v1/notifications/${MISSING_ID}/read`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}` },
      }),
      { params: Promise.resolve({ id: MISSING_ID }) },
    );
    expect(missing.status).toBe(404);
  });

  it('read-all marks every remaining unread and reports the count', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    // After the mark-read test, a3 is the only unread left for USER_A.
    const { rows } = await db.pg.query<{ data: { updated: number } }>(
      `select api_mark_all_notifications_read($1::jsonb) as data`,
      [JSON.stringify({})],
    );
    expect(rows[0]!.data.updated).toBe(1);
    expect((await listRpc(db, { unreadOnly: true })).total).toBe(0);
  });

  it('unread-count is owner-scoped (RPC) and 401s anon (route)', async () => {
    // After read-all, USER_A has 0 unread; USER_B still has its one (b1) unread.
    await db.as({ sub: USER_A, role: 'authenticated' });
    const a = await db.pg.query<{ data: { count: number } }>(
      `select api_notifications_unread_count($1::jsonb) as data`,
      [JSON.stringify({})],
    );
    expect(a.rows[0]!.data.count).toBe(0);

    await db.as({ sub: USER_B, role: 'authenticated' });
    const b = await db.pg.query<{ data: { count: number } }>(
      `select api_notifications_unread_count($1::jsonb) as data`,
      [JSON.stringify({})],
    );
    expect(b.rows[0]!.data.count).toBe(1);

    const token = await mintToken(USER_B);
    const ok = await unreadCountGet(
      new Request('http://localhost/api/v1/notifications/unread-count', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toEqual({ count: 1 });

    const anon = await unreadCountGet(
      new Request('http://localhost/api/v1/notifications/unread-count'),
    );
    expect(anon.status).toBe(401);
  });

  it('route: GET returns the {ok,data,meta} envelope', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const res = await notificationsGet(
      new Request('http://localhost/api/v1/notifications?pageSize=2', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });

  it('route: unreadOnly=true filters; an invalid flag is 400', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const unread = await notificationsGet(
      new Request('http://localhost/api/v1/notifications?unreadOnly=true', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(unread.status).toBe(200);
    expect((await unread.json()).data).toHaveLength(0); // all read by now

    const bad = await notificationsGet(
      new Request('http://localhost/api/v1/notifications?unreadOnly=maybe', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(bad.status).toBe(400);
  });

  it('route: read-all works for the signed-in user; 401 without a token', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const ok = await readAllPost(
      new Request('http://localhost/api/v1/notifications/read-all', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(ok.status).toBe(200);
    expect(typeof (await ok.json()).data.updated).toBe('number');

    const anonList = await notificationsGet(new Request('http://localhost/api/v1/notifications'));
    expect(anonList.status).toBe(401);
    const anonReadAll = await readAllPost(
      new Request('http://localhost/api/v1/notifications/read-all', { method: 'POST' }),
    );
    expect(anonReadAll.status).toBe(401);
  });
});
