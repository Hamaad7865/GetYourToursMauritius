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

const { GET: cardsGet } = await import('../../app/api/v1/saved-cards/route');
const { DELETE: cardDelete } = await import('../../app/api/v1/saved-cards/[id]/route');

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-must-be-long-enough-1234567890';

function mintToken(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}
const authed = (sub: string, init: RequestInit = {}) =>
  mintToken(sub).then(
    (tok) =>
      new Request('http://localhost/api/v1/saved-cards', {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${tok}` },
      }),
  );

describe('saved-cards routes', () => {
  let db: TestDb;

  async function cardIdsFor(sub: string): Promise<string[]> {
    await db.as({ sub, role: 'authenticated' });
    const res = await cardsGet(await authed(sub));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    return body.data.map((c) => c.id);
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const id of [USER_A, USER_B]) {
      await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@x.test`]);
      await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [id]);
    }
    await db.pg.query(
      `insert into saved_cards (user_id, provider_registration_id, brand, last4, exp_month, exp_year)
       values ($1, 'reg_a', 'VISA', '4242', 12, 2030)`,
      [USER_A],
    );
    setRouteContext({
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    });
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  it('GET returns only the caller’s cards, metadata only (no token)', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const res = await cardsGet(await authed(USER_A));
    const body = (await res.json()) as { ok: boolean; data: Array<Record<string, unknown>> };
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ brand: 'VISA', last4: '4242', expMonth: 12 });
    expect(JSON.stringify(body.data)).not.toContain('reg_a'); // token never leaves the server
    expect(await cardIdsFor(USER_B)).toEqual([]); // other user sees nothing
  });

  it('rejects an anonymous caller', async () => {
    const res = await cardsGet(new Request('http://localhost/api/v1/saved-cards'));
    expect(res.status).toBe(401);
  });

  it('DELETE is owner-scoped: another user cannot remove it, the owner can', async () => {
    const id = (await cardIdsFor(USER_A))[0]!;

    await db.as({ sub: USER_B, role: 'authenticated' });
    await cardDelete(await authed(USER_B, { method: 'DELETE' }), {
      params: Promise.resolve({ id }),
    });
    expect(await cardIdsFor(USER_A)).toContain(id); // still there

    await db.as({ sub: USER_A, role: 'authenticated' });
    const res = await cardDelete(await authed(USER_A, { method: 'DELETE' }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    expect(await cardIdsFor(USER_A)).not.toContain(id);
  });
});
