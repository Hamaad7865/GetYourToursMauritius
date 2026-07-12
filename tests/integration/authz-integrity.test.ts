import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const STAFF = '33333333-3333-3333-3333-333333333333';

describe('authz & integrity hardening', () => {
  let db: TestDb;
  let activityId: string;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const id of [USER_A, USER_B, STAFF]) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
    }
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [USER_A]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [USER_B]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff')`, [STAFF]);
    const seeded = await seedOccurrence(db, 10);
    activityId = seeded.activityId;
    occurrenceId = seeded.occurrenceId;
  });

  afterAll(async () => {
    await db.close();
  });

  // Book via the server path (api_book is service-role-only since 20260808000000): flip to service_role,
  // pass the signed-in caller's id (session sub) as actorUserId — exactly what the booking route does —
  // then restore the session. Keeps the raw `{ rows: [{ data }] }` shape the F23/F25 assertions use.
  const apiBook = async (payload: Record<string, unknown>) => {
    const pre = (
      await db.pg.query<{ claims: string | null; role: string }>(
        `select current_setting('request.jwt.claims', true) as claims, current_user as role`,
      )
    ).rows[0]!;
    let sub: string | null = null;
    try {
      sub = pre.claims ? ((JSON.parse(pre.claims).sub as string | undefined) ?? null) : null;
    } catch {
      /* anonymous */
    }
    await db.pg.exec(`reset role;`);
    await db.pg.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ role: 'service_role' }),
    ]);
    await db.pg.exec(`set role service_role;`);
    try {
      return await db.pg.query<{ data: { ref: string; status: string } }>(
        `select api_book($1::jsonb) as data`,
        [JSON.stringify({ ...payload, actorUserId: payload.actorUserId ?? sub })],
      );
    } finally {
      await db.pg.exec(`reset role;`);
      await db.pg.query(`select set_config('request.jwt.claims', $1, false)`, [pre.claims ?? '']);
      if (pre.role === 'anon' || pre.role === 'authenticated' || pre.role === 'service_role') {
        await db.pg.exec(`set role ${pre.role};`);
      }
    }
  };

  it('F2: blocks staff from inserting a booking directly via PostgREST', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      db.pg.query(
        `insert into bookings (customer_name, customer_email, status, payment_state, total_minor)
         values ('Forged', 'forged@x.com', 'confirmed', 'paid', 999999)`,
      ),
    ).rejects.toThrow(/forbidden_direct_write/);
    await db.asOwner();
  });

  it('F12: blocks an authenticated non-staff user from forging a review', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    await expect(
      db.pg.query(
        `insert into reviews (activity_id, author, rating, text) values ($1, 'Hacker', 5, 'fake')`,
        [activityId],
      ),
    ).rejects.toThrow();
    await db.asOwner();
  });

  it('F23: an idempotency-key replay does not disclose another account booking', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const { rows } = await apiBook({
      occurrenceId,
      party: { Adult: 1 },
      customerName: 'Alice',
      customerEmail: 'alice@x.com',
      idempotencyKey: 'shared-replay-key-abc12345',
    });
    expect(rows[0]!.data.status).toBe('payment_pending');

    // User B replays User A's exact key — must be refused, not handed A's booking.
    await db.as({ sub: USER_B, role: 'authenticated' });
    await expect(
      apiBook({
        occurrenceId,
        party: { Adult: 1 },
        customerName: 'Mallory',
        customerEmail: 'mallory@x.com',
        idempotencyKey: 'shared-replay-key-abc12345',
      }),
    ).rejects.toThrow(/forbidden/);
    await db.asOwner();
  });

  it('F23: a guest-booking idempotency replay with a mismatched email is refused (no PII echo)', async () => {
    // A GUEST booking (user_id NULL). Anon can no longer execute api_book (lockdown), so the guest
    // path arrives via the server (service_role: auth.uid() null) — F23's email match is the gate.
    await db.as({ role: 'service_role' });
    const { rows } = await apiBook({
      occurrenceId,
      party: { Adult: 1 },
      customerName: 'Guest Grace',
      customerEmail: 'grace@x.com',
      idempotencyKey: 'guest-replay-key-abc12345',
    });
    expect(rows[0]!.data.status).toBe('payment_pending');
    const originalRef = rows[0]!.data.ref;

    // An attacker who only stole/guessed the key (not Grace's email) replays it. Before the fix this
    // echoed back Grace's name/email/ref/items; now it must be refused.
    await expect(
      apiBook({
        occurrenceId,
        party: { Adult: 1 },
        customerName: 'Eve',
        customerEmail: 'eve@evil.com',
        idempotencyKey: 'guest-replay-key-abc12345',
      }),
    ).rejects.toThrow(/forbidden/);

    // The legitimate same-caller retry resends Grace's email and still gets her booking back.
    const { rows: retry } = await apiBook({
      occurrenceId,
      party: { Adult: 1 },
      customerName: 'Guest Grace',
      customerEmail: 'GRACE@x.com', // case-insensitive match
      idempotencyKey: 'guest-replay-key-abc12345',
    });
    expect(retry[0]!.data.ref).toBe(originalRef);
    await db.asOwner();
  });

  it('F25: an overflowing party quantity is a clean invalid_party, not a 502 overflow', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    await expect(
      apiBook({
        occurrenceId,
        party: { Adult: 2147483648 }, // > int4 max — would overflow the cast
        customerName: 'Overflow',
        customerEmail: 'overflow@x.com',
        idempotencyKey: 'overflow-key-12345678',
      }),
    ).rejects.toThrow(/invalid_party/);
    await db.asOwner();
  });
});
