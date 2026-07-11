import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

/**
 * P1: an admin cancel of a PAID booking flips it to refund_pending, but nothing ever moves it on to
 * refunded — the only code that records a refund is the `refunded` provider event (webhook), which a
 * manual Peach-dashboard refund never produces. api_mark_refunded is the staff door: it records the
 * refund through the SAME append_payment_event ledger path the webhook uses, so the booking transitions
 * to refunded, refunded_minor is set, and the booking_refunded customer email is enqueued — once.
 */

const ITEMS = JSON.stringify([{ price_label: 'Adult', quantity: 1 }]);
const STAFF = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const CUSTOMER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** Confirmed + fully-paid booking, then admin-cancelled → refund_pending (the real gap state). */
async function makeRefundPending(
  db: TestDb,
  key: string,
): Promise<{ id: string; paymentId: string }> {
  await db.asOwner();
  const { occurrenceId } = await seedOccurrence(db, 5);
  const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 1, $2)`, [
    occurrenceId,
    `${key}-h`,
  ]);
  const { rows: b } = await db.pg.query<{ id: string }>(
    `select * from create_booking($1, $2, 'Refund Tester', 'refund@example.com', null, 'web'::booking_source, $3::jsonb)`,
    [`${key}-bk`, h[0]!.id, ITEMS],
  );
  const bookingId = b[0]!.id;

  // Create the payment row (amount = the booking total) and drive it to PAID via the ledger path.
  const { rows: p } = await db.pg.query<{ id: string }>(
    `insert into payments (booking_id, idempotency_key, amount_minor, status)
     values ($1, $2, 7500, 'pending') returning id`,
    [bookingId, `${key}-pay`],
  );
  const paymentId = p[0]!.id;
  // A real `paid` provider event confirms the booking (append_payment_event runs as owner here).
  await db.pg.query(`select append_payment_event($1, 'paid', $2, 7500, now(), '{}'::jsonb)`, [
    paymentId,
    `${key}-evt-paid`,
  ]);

  // Admin cancels the now confirmed+paid booking → the guard reroutes it to refund_pending.
  await db.as({ sub: STAFF, role: 'authenticated' });
  await db.pg.query(`update bookings set status = 'cancelled' where id = $1`, [bookingId]);
  await db.asOwner();

  return { id: bookingId, paymentId };
}

const status = async (db: TestDb, id: string) =>
  (await db.pg.query<{ status: string }>(`select status from bookings where id = $1`, [id]))
    .rows[0]!.status;

const refundNotifications = async (db: TestDb, id: string) =>
  (
    await db.pg.query<{ n: number | string }>(
      `select count(*) as n from notification_outbox where booking_id = $1 and template = 'booking_refunded'`,
      [id],
    )
  ).rows[0]!.n;

const callMarkRefunded = (db: TestDb, id: string) =>
  db.pg.query(`select api_mark_refunded($1::jsonb)`, [JSON.stringify({ bookingId: id })]);

describe('api_mark_refunded records a manual refund', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff')`, [STAFF]);
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('transitions refund_pending → refunded, sets refunded_minor, and enqueues the customer email', async () => {
    const { id, paymentId } = await makeRefundPending(db, 'happy');
    await db.asOwner();
    expect(await status(db, id)).toBe('refund_pending'); // precondition: the stuck state

    await db.as({ sub: STAFF, role: 'authenticated' });
    await callMarkRefunded(db, id);
    await db.asOwner();

    expect(await status(db, id)).toBe('refunded');
    const pay = (
      await db.pg.query<{ status: string; refunded_minor: number | string }>(
        `select status, refunded_minor from payments where id = $1`,
        [paymentId],
      )
    ).rows[0]!;
    expect(pay.status).toBe('refunded');
    expect(Number(pay.refunded_minor)).toBe(7500); // full paid amount reversed
    expect(Number(await refundNotifications(db, id))).toBe(1); // booking_refunded email queued
  });

  it('is idempotent — a second call is a no-op (no error, no second email)', async () => {
    const { id } = await makeRefundPending(db, 'idem');
    await db.as({ sub: STAFF, role: 'authenticated' });
    await callMarkRefunded(db, id);
    await callMarkRefunded(db, id); // repeat click
    await db.asOwner();

    expect(await status(db, id)).toBe('refunded');
    expect(Number(await refundNotifications(db, id))).toBe(1); // still exactly one
  });

  it('rejects a non-staff caller', async () => {
    const { id } = await makeRefundPending(db, 'authz');
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(callMarkRefunded(db, id)).rejects.toThrow(/forbidden/);
    await db.asOwner();
    expect(await status(db, id)).toBe('refund_pending'); // unchanged
  });

  it('rejects an unpaid booking (nothing to refund)', async () => {
    await db.asOwner();
    const { occurrenceId } = await seedOccurrence(db, 5);
    const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 1, $2)`, [
      occurrenceId,
      'unpaid-h',
    ]);
    const { rows: b } = await db.pg.query<{ id: string }>(
      `select * from create_booking($1, $2, 'X', 'x@x.com', null, 'web'::booking_source, $3::jsonb)`,
      ['unpaid-bk', h[0]!.id, ITEMS],
    );
    const id = b[0]!.id;

    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(callMarkRefunded(db, id)).rejects.toThrow(/payment_not_found|not_refundable/);
    await db.asOwner();
  });
});
