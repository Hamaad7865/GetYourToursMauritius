import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { runBookingMaintenance } from '@/lib/services/maintenance';
import { listMyPendingBookings } from '@/lib/services/bookings';

const ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function book(db: TestDb, key: string, email = 'cust@example.com'): Promise<string> {
  const oid = (await db.pg.query<{ id: string }>(`select id from session_occurrences limit 1`))
    .rows[0]!.id;
  const { rows } = await db.pg.query<{ data: { ref: string } }>(
    `select api_book($1::jsonb) as data`,
    [
      JSON.stringify({
        occurrenceId: oid,
        party: { Adult: 2 },
        customerName: 'Cust',
        customerEmail: email,
        source: 'web',
        idempotencyKey: key,
      }),
    ],
  );
  return rows[0]!.data.ref;
}

describe('pending bookings in cart + safe auto-cancel', () => {
  let db: TestDb;
  let ctx: ServiceContext;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    for (const uid of [ALICE, BOB]) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [uid]);
      await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [uid]);
    }
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'pend-tour', 'activity', 'Pending Tour', 'Sightseeing tours', 'published') returning id`,
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
       values ($1, $2, now() + interval '3 days', now() + interval '3 days 3 hours', 50)`,
      [optId, operatorId],
    );
    ctx = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    };
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns only the caller’s payment_pending bookings, joined to the active hold expiry', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const aliceRef = await book(db, 'pend-alice-1', 'alice@example.com');
    await db.as({ sub: BOB, role: 'authenticated' });
    await book(db, 'pend-bob-1', 'bob@example.com');

    await db.as({ sub: ALICE, role: 'authenticated' });
    const { rows } = await db.pg.query<{
      data: Array<{ ref: string; status: string; holdExpiresAt: string | null; title: string }>;
    }>(`select api_my_pending_bookings('{}'::jsonb) as data`);
    const list = rows[0]!.data;
    expect(list.map((b) => b.ref)).toEqual([aliceRef]); // not Bob's
    expect(list[0]!.status).toBe('payment_pending');
    expect(list[0]!.title).toBe('Pending Tour');
    expect(list[0]!.holdExpiresAt).toBeTruthy(); // joined from the live hold → drives the cart countdown

    // Same result via the service layer — proves the zod schema matches the RPC's jsonb output.
    const viaService = await listMyPendingBookings(ctx);
    expect(viaService.map((b) => b.ref)).toEqual([aliceRef]);
    expect(viaService[0]!.holdExpiresAt).toBeTruthy();
  });

  it('excludes confirmed bookings and refuses a caller with no user id', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book(db, 'pend-alice-confirmed');
    await db.asOwner();
    await db.pg.query(`update bookings set status='confirmed', payment_state='paid' where ref=$1`, [
      ref,
    ]);

    await db.as({ sub: ALICE, role: 'authenticated' });
    const { rows } = await db.pg.query<{ data: Array<{ ref: string }> }>(
      `select api_my_pending_bookings('{}'::jsonb) as data`,
    );
    expect(rows[0]!.data.find((b) => b.ref === ref)).toBeUndefined();

    // authenticated role but no sub → auth.uid() is null → guarded.
    await db.as({ role: 'authenticated' });
    await expect(db.pg.query(`select api_my_pending_bookings('{}'::jsonb)`)).rejects.toThrow(
      /unauthorized/i,
    );
  });

  it('auto-expires a stale unpaid booking: status + hold + one audit row + one expiry email', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book(db, 'pend-stale-1', 'stale@example.com');
    await db.asOwner();
    await db.pg.query(`update bookings set created_at = now() - interval '2 hours' where ref=$1`, [
      ref,
    ]);

    const result = await runBookingMaintenance(ctx, 30);
    expect(result.bookingsExpired).toBeGreaterThanOrEqual(1);

    const b = (
      await db.pg.query<{ id: string; status: string }>(
        `select id, status from bookings where ref=$1`,
        [ref],
      )
    ).rows[0]!;
    expect(b.status).toBe('expired');

    const holdReleased = (
      await db.pg.query<{ status: string }>(
        `select h.status from booking_holds h join bookings bk on bk.id=h.booking_id where bk.ref=$1`,
        [ref],
      )
    ).rows.every((h) => h.status === 'released');
    expect(holdReleased).toBe(true);

    const audits = Number(
      (
        await db.pg.query<{ n: string }>(
          `select count(*) n from audit_logs where action='auto_expire_booking' and entity_id=$1`,
          [b.id],
        )
      ).rows[0]!.n,
    );
    expect(audits).toBe(1);

    const notifs = Number(
      (
        await db.pg.query<{ n: string }>(
          `select count(*) n from notification_outbox where template='booking_expired' and booking_id=$1`,
          [b.id],
        )
      ).rows[0]!.n,
    );
    expect(notifs).toBe(1);

    // Idempotent: a second sweep can't re-expire (no longer payment_pending) → no second email.
    await runBookingMaintenance(ctx, 30);
    const notifs2 = Number(
      (
        await db.pg.query<{ n: string }>(
          `select count(*) n from notification_outbox where template='booking_expired' and booking_id=$1`,
          [b.id],
        )
      ).rows[0]!.n,
    );
    expect(notifs2).toBe(1);
  });

  it('NEVER expires a booking that has a settled payment (money-path guard)', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book(db, 'pend-paid-1', 'paid@example.com');
    await db.asOwner();
    const bid = (await db.pg.query<{ id: string }>(`select id from bookings where ref=$1`, [ref]))
      .rows[0]!.id;
    // Projection still 'pending' (webhook lagging) but a PAID payment row exists — must survive the sweep.
    await db.pg.query(`update bookings set created_at = now() - interval '2 hours' where ref=$1`, [
      ref,
    ]);
    await db.pg.query(
      `insert into payments (booking_id, idempotency_key, amount_minor, status, paid_minor)
       values ($1, $2, 10000, 'paid', 10000)`,
      [bid, `pay-${bid}`],
    );

    await runBookingMaintenance(ctx, 30);

    const status = (
      await db.pg.query<{ status: string }>(`select status from bookings where ref=$1`, [ref])
    ).rows[0]!.status;
    expect(status).toBe('payment_pending'); // untouched
    const audits = Number(
      (
        await db.pg.query<{ n: string }>(
          `select count(*) n from audit_logs where action='auto_expire_booking' and entity_id=$1`,
          [bid],
        )
      ).rows[0]!.n,
    );
    expect(audits).toBe(0);
  });
});
