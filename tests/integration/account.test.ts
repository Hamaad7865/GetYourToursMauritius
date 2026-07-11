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
// The delete route removes the auth user via the service-role Admin API; stub it (no real Supabase in tests).
const deleteUser = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({ auth: { admin: { deleteUser } } }),
}));

const { GET: profileGet, PATCH: profilePatch } = await import('../../app/api/v1/account/profile/route');
const { GET: exportGet } = await import('../../app/api/v1/account/export/route');
const { POST: deletePost } = await import('../../app/api/v1/account/delete/route');

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-must-be-long-enough-1234567890';

async function mintToken(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}
const authed = (sub: string, init: RequestInit = {}) =>
  mintToken(sub).then(
    (t) =>
      new Request('http://localhost/api/v1/account', {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${t}` },
      }),
  );

describe('account (profile / export / delete)', () => {
  let db: TestDb;

  async function seedBooking(userId: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(
      `insert into bookings (user_id, customer_name, customer_email, total_minor, currency, status)
       values ($1, 'Cust', 'c@example.com', 9000, 'EUR', 'confirmed')`,
      [userId],
    );
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const id of [USER_A, USER_B, USER_C, USER_D]) {
      await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@example.com`]);
    }
    // A, B, D have profiles; C does NOT (tests create-if-missing). D + A get a booking.
    await db.pg.query(`insert into profiles (id, role, full_name) values ($1, 'customer', 'Alice')`, [USER_A]);
    await db.pg.query(`insert into profiles (id, role, full_name) values ($1, 'customer', 'Bob')`, [USER_B]);
    await db.pg.query(`insert into profiles (id, role, full_name) values ($1, 'customer', 'Dan')`, [USER_D]);
    await seedBooking(USER_A);
    await seedBooking(USER_D);

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

  it('GET profile creates the row if missing', async () => {
    await db.as({ sub: USER_C, role: 'authenticated' });
    const res = await profileGet(await authed(USER_C));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: USER_C, fullName: null, role: 'customer' });
    expect(typeof body.data.memberSince).toBe('string');

    await db.asOwner();
    const exists = await db.pg.query<{ n: number }>(`select count(*)::int n from profiles where id = $1`, [USER_C]);
    expect(exists.rows[0]!.n).toBe(1);
  });

  it('PATCH updates only provided keys (partial update keeps the rest)', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const full = await profilePatch(
      await authed(USER_A, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: 'Alice Updated', phone: '+23012345678', dateOfBirth: '1990-05-15' }),
      }),
    );
    expect(full.status).toBe(200);
    expect((await full.json()).data).toMatchObject({
      fullName: 'Alice Updated',
      phone: '+23012345678',
      dateOfBirth: '1990-05-15',
    });

    // Partial: change only phone, fullName + dateOfBirth must persist.
    const partial = await profilePatch(
      await authed(USER_A, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '+23099999999' }),
      }),
    );
    expect((await partial.json()).data).toMatchObject({
      fullName: 'Alice Updated',
      phone: '+23099999999',
      dateOfBirth: '1990-05-15',
    });

    const bad = await profilePatch(
      await authed(USER_A, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dateOfBirth: 'not-a-date' }),
      }),
    );
    expect(bad.status).toBe(400);
  });

  it('export includes dateOfBirth (which the web export omits) + the bookings', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const res = await exportGet(await authed(USER_A));
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.profile).toMatchObject({ dateOfBirth: '1990-05-15', email: `${USER_A}@example.com` });
    expect(Array.isArray(data.bookings)).toBe(true);
    expect(data.bookings.length).toBe(1);
    expect(data.bookings[0]).toMatchObject({ totalEur: 90, currency: 'EUR', status: 'confirmed' });
  });

  it('profile is owner-scoped', async () => {
    await db.as({ sub: USER_B, role: 'authenticated' });
    const res = await profileGet(await authed(USER_B));
    expect((await res.json()).data).toMatchObject({ id: USER_B, fullName: 'Bob' });
  });

  it('delete erases the caller’s data and removes the auth user', async () => {
    await db.as({ sub: USER_D, role: 'authenticated' });
    const res = await deletePost(await authed(USER_D, { method: 'POST' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ deleted: true });
    expect(deleteUser).toHaveBeenCalledWith(USER_D);

    await db.asOwner();
    const prof = await db.pg.query<{ n: number }>(`select count(*)::int n from profiles where id = $1`, [USER_D]);
    expect(prof.rows[0]!.n).toBe(0); // api_erase_user deleted the profile
  });

  it('401 without a token (profile GET/PATCH, export, delete)', async () => {
    expect((await profileGet(new Request('http://localhost/api/v1/account/profile'))).status).toBe(401);
    expect(
      (
        await profilePatch(
          new Request('http://localhost/api/v1/account/profile', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }),
        )
      ).status,
    ).toBe(401);
    expect((await exportGet(new Request('http://localhost/api/v1/account/export'))).status).toBe(401);
    expect(
      (await deletePost(new Request('http://localhost/api/v1/account/delete', { method: 'POST' }))).status,
    ).toBe(401);
  });
});
