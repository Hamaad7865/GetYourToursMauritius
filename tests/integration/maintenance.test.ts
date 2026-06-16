import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { runBookingMaintenance } from '@/lib/services/maintenance';

const CUSTOMER = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2';

async function book(db: TestDb, key: string): Promise<string> {
  const { rows } = await db.pg.query<{ data: { ref: string } }>(`select api_book($1::jsonb) as data`, [
    JSON.stringify({
      occurrenceId: (await db.pg.query<{ id: string }>(`select id from session_occurrences limit 1`)).rows[0]!.id,
      party: { Adult: 2 },
      customerName: 'Abandoner',
      customerEmail: 'abandon@example.com',
      source: 'web',
      idempotencyKey: key,
    }),
  ]);
  return rows[0]!.data.ref;
}

describe('run_booking_maintenance: sweep holds + expire abandoned bookings', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`);
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'maint-tour', 'activity', 'Maint Tour', 'Sightseeing tours', 'published') returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    const optId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 5000)`,
      [optId],
    );
    await db.pg.query(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
       values ($1, $2, now() + interval '3 days', now() + interval '3 days 3 hours', 20)`,
      [optId, operatorId],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('expires a stale never-paid booking and releases its hold; leaves a fresh one alone', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const staleRef = await book(db, 'maint-stale-0001');
    const freshRef = await book(db, 'maint-fresh-0001');

    // Backdate the stale booking past the grace window (as owner — the admin guard lets the
    // owner/SECURITY DEFINER path through).
    await db.asOwner();
    await db.pg.query(`update bookings set created_at = now() - interval '2 hours' where ref = $1`, [staleRef]);

    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    };
    const result = await runBookingMaintenance(ctx, 30);
    expect(result.bookingsExpired).toBe(1);

    const stale = (await db.pg.query<{ status: string }>(`select status from bookings where ref = $1`, [staleRef])).rows[0]!;
    const fresh = (await db.pg.query<{ status: string }>(`select status from bookings where ref = $1`, [freshRef])).rows[0]!;
    expect(stale.status).toBe('expired');
    expect(fresh.status).toBe('payment_pending');

    // The stale booking's hold was released so the seats are freed.
    const holds = (
      await db.pg.query<{ status: string }>(
        `select h.status from booking_holds h join bookings b on b.id = h.booking_id where b.ref = $1`,
        [staleRef],
      )
    ).rows;
    expect(holds.every((h) => h.status === 'released')).toBe(true);
  });
});
