import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { seedOccurrence } from '../db/seed';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';

// Route handlers read their ServiceContext through this seam; back it with the same PGlite DB.
vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return {
    buildServiceContext: () => mod.requireRouteContext(),
    serviceRoleRpcContext: () => mod.requireRouteContext(),
  };
});

const { GET: bookingsGet } = await import('../../app/api/v1/bookings/route');

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-must-be-long-enough-1234567890';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (days: number) => iso(new Date(Date.now() + days * 86_400_000));

async function mintToken(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

interface History {
  items: Array<{
    ref: string;
    title: string;
    status: string;
    paymentState: string;
    totalEur: number;
    currency: string;
    startsAt: string | null;
    heroImage: { id: string; url: string } | null;
    createdAt: string;
  }>;
  total: number;
}

/** Call api_my_bookings directly under the current PGlite identity (set via db.as). */
async function history(db: TestDb, params: Record<string, unknown> = {}): Promise<History> {
  const { rows } = await db.pg.query<{ data: History }>(
    `select api_my_bookings($1::jsonb) as data`,
    [JSON.stringify(params)],
  );
  return rows[0]!.data;
}

describe('GET /api/v1/bookings — booking history', () => {
  let db: TestDb;
  let nearOccurrenceId: string;
  let farOccurrenceId: string;
  let optionId: string;
  // Refs in creation order so tests can assert newest-first ordering.
  const refs: Record<string, string> = {};

  async function makeBooking(
    userId: string,
    opts: { key: string; status: string; occurrenceId: string; createdAt: string },
  ): Promise<void> {
    const { rows } = await db.pg.query<{ id: string; ref: string }>(
      `insert into bookings (user_id, customer_name, customer_email, total_minor, status, created_at)
       values ($1, 'Cust', 'cust@example.com', 11000, $2, $3) returning id, ref`,
      [userId, opts.status, opts.createdAt],
    );
    refs[opts.key] = rows[0]!.ref;
    await db.pg.query(
      `insert into booking_items
         (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 1, 11000, 11000)`,
      [rows[0]!.id, opts.occurrenceId, optionId],
    );
  }

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

    const seed = await seedOccurrence(db, 10);
    optionId = seed.optionId;
    nearOccurrenceId = seed.occurrenceId; // starts_at = now() + 2 days
    // A hero image so heroImage resolves to a non-null object.
    await db.pg.query(
      `insert into activity_images (activity_id, url, alt, position) values ($1, 'https://img/hero.jpg', 'Hero', 0)`,
      [seed.activityId],
    );
    // A second, far-future occurrence on the same option, for the trip-date filter.
    const { rows: far } = await db.pg.query<{ id: string }>(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
       values ($1, $2, now() + interval '90 days', now() + interval '90 days 4 hours', 10) returning id`,
      [seed.optionId, seed.operatorId],
    );
    farOccurrenceId = far[0]!.id;

    // USER_A: two near (confirmed + pending) and one far (confirmed, newest). USER_B: one near.
    await makeBooking(USER_A, {
      key: 'a1',
      status: 'confirmed',
      occurrenceId: nearOccurrenceId,
      createdAt: plusDays(-3),
    });
    await makeBooking(USER_A, {
      key: 'a2',
      status: 'payment_pending',
      occurrenceId: nearOccurrenceId,
      createdAt: plusDays(-2),
    });
    await makeBooking(USER_A, {
      key: 'a3',
      status: 'confirmed',
      occurrenceId: farOccurrenceId,
      createdAt: plusDays(-1),
    });
    await makeBooking(USER_B, {
      key: 'b1',
      status: 'confirmed',
      occurrenceId: nearOccurrenceId,
      createdAt: plusDays(-1),
    });

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

  it('returns the caller’s bookings newest-first with totalEur (EUR major) + heroImage', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const data = await history(db);
    expect(data.total).toBe(3);
    expect(data.items.map((b) => b.ref)).toEqual([refs.a3, refs.a2, refs.a1]); // created_at DESC
    const first = data.items[0]!;
    expect(first.totalEur).toBe(110); // 11000 minor / 100 — never a *Minor field
    expect(first.currency).toBe('EUR');
    expect(first.title).toMatch(/Activity/);
    expect(first.startsAt).toBeTruthy();
    expect(first.heroImage?.url).toBe('https://img/hero.jpg');
    expect(typeof first.createdAt).toBe('string');
  });

  it('never leaks another user’s bookings (ownership isolation)', async () => {
    await db.as({ sub: USER_B, role: 'authenticated' });
    const data = await history(db);
    expect(data.total).toBe(1);
    expect(data.items.map((b) => b.ref)).toEqual([refs.b1]);
    // None of USER_A's refs appear for USER_B.
    expect(data.items.some((b) => [refs.a1, refs.a2, refs.a3].includes(b.ref))).toBe(false);
  });

  it('rejects an unauthenticated caller', async () => {
    await db.as(null);
    await expect(history(db)).rejects.toThrow();
  });

  it('filters by status', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const data = await history(db, { status: 'confirmed' });
    expect(data.total).toBe(2);
    expect(data.items.every((b) => b.status === 'confirmed')).toBe(true);
    expect(data.items.map((b) => b.ref).sort()).toEqual([refs.a1, refs.a3].sort());
  });

  it('filters by trip-date window (from / to)', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const onlyFar = await history(db, { from: plusDays(30) });
    expect(onlyFar.items.map((b) => b.ref)).toEqual([refs.a3]);

    const onlyNear = await history(db, { to: plusDays(10) });
    expect(onlyNear.total).toBe(2);
    expect(onlyNear.items.map((b) => b.ref).sort()).toEqual([refs.a1, refs.a2].sort());
  });

  it('paginates with offset (page / pageSize) and a stable total', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const page1 = await history(db, { page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.items.map((b) => b.ref)).toEqual([refs.a3, refs.a2]);

    const page2 = await history(db, { page: 2, pageSize: 2 });
    expect(page2.total).toBe(3);
    expect(page2.items.map((b) => b.ref)).toEqual([refs.a1]);
  });

  it('route: 401 without a token', async () => {
    const res = await bookingsGet(new Request('http://localhost/api/v1/bookings'));
    expect(res.status).toBe(401);
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('route: returns the {ok,data,meta} envelope for the signed-in user', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const res = await bookingsGet(
      new Request('http://localhost/api/v1/bookings?pageSize=2', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(2);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });

  it('route: 400 on an invalid status filter', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const token = await mintToken(USER_A);
    const res = await bookingsGet(
      new Request('http://localhost/api/v1/bookings?status=not-a-status', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(400);
  });
});
