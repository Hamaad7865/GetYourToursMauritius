import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

/**
 * Owner-scoped hold release (Cart & Hold Lifecycle, Task 4).
 *
 * Holds gained a `created_by` owner column, stamped on creation via the real app
 * wrapper `api_create_hold` (which delegates the INSERT to create_hold). The new
 * owner-scoped `api_release_hold(holdId)` lets the hold's owner (or staff) release
 * it; a different signed-in user is rejected and the capacity stays held.
 *
 * api_create_hold JSON shape (see src/lib/services/holds.ts):
 *   { occurrenceId, expectedSlug?, people, idempotencyKey } -> { holdId, quantity, expiresAt }
 */

// Fixed UUIDs so auth.uid() is deterministic per caller.
const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

/**
 * Create a hold for a user exactly as the holds ROUTE does since the lockdown: api_create_hold is
 * service-role-only, and the route passes the JWKS-verified user id (p.userId) for the RPC to stamp as
 * the hold's owner. Leaves the session signed in as that user afterwards.
 */
async function holdFor<T = unknown>(
  db: TestDb,
  user: string,
  params: Record<string, unknown>,
): Promise<T> {
  await db.as({ role: 'service_role' });
  const data = await call<T>(db, 'api_create_hold', { ...params, userId: user });
  await db.as({ sub: user, role: 'authenticated' });
  return data;
}

async function usedCapacity(db: TestDb, occurrenceId: string): Promise<number> {
  const { rows } = await db.pg.query<{ u: number }>(`select used_capacity($1) as u`, [
    occurrenceId,
  ]);
  return Number(rows[0]!.u);
}

describe('owner-scoped hold release', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    // Two signed-in users; profiles default to 'customer' so neither is staff.
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [ALICE, BOB]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer'), ($2, 'customer')`, [
      ALICE,
      BOB,
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('stamps created_by, lets the owner release, and blocks a different user', async () => {
    await db.asOwner();
    const { occurrenceId } = await seedOccurrence(db, 10);

    // ALICE creates a hold via the real app path (route → service-role RPC with her verified id).
    const hold = await holdFor<{ holdId: string; quantity: number }>(db, ALICE, {
      occurrenceId,
      expectedSlug: null,
      people: 4,
      idempotencyKey: 'alice-hold:hold',
    });
    expect(hold.holdId).toBeTruthy();
    expect(hold.quantity).toBe(4);

    // Capacity is reserved by the active hold, and the hold is owned by ALICE.
    await db.asOwner();
    expect(await usedCapacity(db, occurrenceId)).toBe(4);
    const { rows: owned } = await db.pg.query<{ created_by: string }>(
      `select created_by from booking_holds where id = $1`,
      [hold.holdId],
    );
    expect(owned[0]!.created_by).toBe(ALICE);

    // BOB (a different signed-in user) cannot release ALICE's hold.
    await db.as({ sub: BOB, role: 'authenticated' });
    await expect(db.pg.query(`select api_release_hold($1)`, [hold.holdId])).rejects.toThrow(
      /forbidden|hold_not_found/,
    );

    // Capacity is still held after the rejected attempt.
    await db.asOwner();
    expect(await usedCapacity(db, occurrenceId)).toBe(4);

    // ALICE releases her own hold -> capacity freed.
    await db.as({ sub: ALICE, role: 'authenticated' });
    const { rows: released } = await db.pg.query<{ status: string }>(
      `select status from api_release_hold($1)`,
      [hold.holdId],
    );
    expect(released[0]!.status).toBe('released');

    await db.asOwner();
    expect(await usedCapacity(db, occurrenceId)).toBe(0);
  });

  it("owner SELECT policy: a user can read their own hold but not another user's", async () => {
    await db.asOwner();
    const { occurrenceId } = await seedOccurrence(db, 10);

    const hold = await holdFor<{ holdId: string }>(db, ALICE, {
      occurrenceId,
      expectedSlug: null,
      people: 2,
      idempotencyKey: 'alice-select:hold',
    });

    // ALICE sees her own hold under RLS.
    const { rows: mine } = await db.pg.query<{ id: string }>(
      `select id from booking_holds where id = $1`,
      [hold.holdId],
    );
    expect(mine).toHaveLength(1);

    // BOB cannot see ALICE's hold under RLS (no staff, not the owner).
    await db.as({ sub: BOB, role: 'authenticated' });
    const { rows: theirs } = await db.pg.query<{ id: string }>(
      `select id from booking_holds where id = $1`,
      [hold.holdId],
    );
    expect(theirs).toHaveLength(0);
  });

  it('release is idempotent: releasing an already-released hold is a no-op', async () => {
    await db.asOwner();
    const { occurrenceId } = await seedOccurrence(db, 10);

    const hold = await holdFor<{ holdId: string }>(db, ALICE, {
      occurrenceId,
      expectedSlug: null,
      people: 3,
      idempotencyKey: 'alice-idem:hold',
    });

    await db.pg.query(`select api_release_hold($1)`, [hold.holdId]);
    // Second release does not raise.
    await expect(db.pg.query(`select api_release_hold($1)`, [hold.holdId])).resolves.toBeDefined();

    await db.asOwner();
    const { rows } = await db.pg.query<{ status: string }>(
      `select status from booking_holds where id = $1`,
      [hold.holdId],
    );
    expect(rows[0]!.status).toBe('released');
  });
});
