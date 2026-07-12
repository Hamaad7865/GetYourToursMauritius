import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

/**
 * REAL grant enforcement for the public-mutation lockdown (20260806 + 20260807). The harness applies
 * every migration to real Postgres, so `has_function_privilege` here proves the migrations' end state —
 * including the PUBLIC subtlety the first lockdown missed: privileges are additive and anon /
 * authenticated are members of PUBLIC, so revoking the member roles alone leaves the implicit
 * create-function PUBLIC grant admitting them. 20260807 revokes public AND the member roles.
 *
 * Plus the hold-ownership regression fix: the holds route calls api_create_hold through a service-role
 * client (auth.uid() null inside), so the RPC must stamp created_by from the route's verified p.userId
 * or signed-in customers' holds land ownerless (invisible to their pending list, unreleasable).
 */

const USER = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';

describe('mutation RPC grants (has_function_privilege — real ACL state)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  const can = async (role: string, fn: string): Promise<boolean> => {
    const { rows } = await db.pg.query<{ ok: boolean }>(
      `select has_function_privilege($1, $2, 'execute') as ok`,
      [role, fn],
    );
    return rows[0]!.ok;
  };

  it.each([
    'api_create_hold(jsonb)',
    'create_hold(uuid, int, text)',
    'api_capture_lead(jsonb)',
    'api_rate_limit(jsonb)',
    'create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)',
    'api_record_payment_charge(jsonb)',
    'api_record_payment_checkout(jsonb)',
    // api_book is server-only too (20260808000000): `authenticated` could otherwise POST it directly and
    // bypass the route's per-IP booking limiter. The route passes the verified user id as actorUserId.
    'api_book(jsonb)',
  ])('server-only: %s — anon/authenticated denied, service_role allowed', async (fn) => {
    expect(await can('anon', fn)).toBe(false);
    expect(await can('authenticated', fn)).toBe(false);
    expect(await can('service_role', fn)).toBe(true);
  });

  it.each(['api_create_payment(jsonb)'])(
    'signed-in-only: %s — anon denied, authenticated + service_role allowed',
    async (fn) => {
      expect(await can('anon', fn)).toBe(false);
      expect(await can('authenticated', fn)).toBe(true);
      expect(await can('service_role', fn)).toBe(true);
    },
  );
});

describe('api_create_hold stamps created_by for the server-mediated (service-role) path', () => {
  let db: TestDb;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    ({ occurrenceId } = await seedOccurrence(db, 8));
    await db.pg.query(`insert into auth.users (id) values ($1)`, [USER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [USER]);
  });

  afterAll(async () => {
    await db.close();
  });

  const createHold = async (payload: Record<string, unknown>) => {
    const { rows } = await db.pg.query<{ data: { holdId: string } }>(
      `select api_create_hold($1::jsonb) as data`,
      [JSON.stringify(payload)],
    );
    return rows[0]!.data;
  };
  const ownerOf = async (holdId: string): Promise<string | null> => {
    await db.asOwner();
    return (
      await db.pg.query<{ created_by: string | null }>(
        `select created_by from booking_holds where id = $1`,
        [holdId],
      )
    ).rows[0]!.created_by;
  };

  it('service-role call with the route-verified userId → created_by stamped; the customer can release', async () => {
    await db.as({ role: 'service_role' });
    const hold = await createHold({
      occurrenceId,
      people: 2,
      idempotencyKey: 'grant-hold-owned',
      userId: USER,
    });
    expect(await ownerOf(hold.holdId)).toBe(USER);

    // The whole point of the stamp: api_release_hold requires created_by = auth.uid().
    await db.as({ sub: USER, role: 'authenticated' });
    const { rows } = await db.pg.query<{ status: string }>(
      `select (api_release_hold($1::uuid)).status as status`,
      [hold.holdId],
    );
    expect(rows[0]!.status).toBe('released');
  });

  it('guest (no userId) stays anonymous — created_by null, as before', async () => {
    await db.as({ role: 'service_role' });
    const hold = await createHold({ occurrenceId, people: 1, idempotencyKey: 'grant-hold-guest' });
    expect(await ownerOf(hold.holdId)).toBeNull();
  });

  it('an idempotent replay with a DIFFERENT userId never re-assigns an owned hold', async () => {
    await db.as({ role: 'service_role' });
    const first = await createHold({
      occurrenceId,
      people: 1,
      idempotencyKey: 'grant-hold-replay',
      userId: USER,
    });
    const replay = await createHold({
      occurrenceId,
      people: 1,
      idempotencyKey: 'grant-hold-replay',
      userId: 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6',
    });
    expect(replay.holdId).toBe(first.holdId);
    expect(await ownerOf(first.holdId)).toBe(USER); // the original owner survives the replay
  });
});
