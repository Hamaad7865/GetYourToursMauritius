import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

const ITEMS = JSON.stringify([{ price_label: 'Adult', quantity: 1 }]);
const STAFF = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/** Create a fresh booking (owner context) and return its id. Status = payment_pending. */
async function makeBooking(db: TestDb, key: string): Promise<{ id: string; occurrenceId: string }> {
  await db.asOwner();
  const { occurrenceId } = await seedOccurrence(db, 5);
  const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 1, $2)`, [
    occurrenceId,
    `${key}-h`,
  ]);
  const { rows: b } = await db.pg.query<{ id: string }>(
    `select * from create_booking($1, $2, 'X', 'x@x.com', null, 'web'::booking_source, $3::jsonb)`,
    [`${key}-bk`, h[0]!.id, ITEMS],
  );
  return { id: b[0]!.id, occurrenceId };
}

const status = async (db: TestDb, id: string) =>
  (await db.pg.query<{ status: string }>(`select status from bookings where id = $1`, [id])).rows[0]!
    .status;
const paymentState = async (db: TestDb, id: string) =>
  (await db.pg.query<{ payment_state: string }>(`select payment_state from bookings where id = $1`, [id]))
    .rows[0]!.payment_state;

describe('admin booking write guards', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff')`, [STAFF]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('lets staff cancel a payment_pending booking', async () => {
    const { id } = await makeBooking(db, 'cancel');
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`update bookings set status = 'cancelled' where id = $1`, [id]);
    await db.asOwner();
    expect(await status(db, id)).toBe('cancelled');
  });

  it('lets staff mark a confirmed booking completed', async () => {
    const { id } = await makeBooking(db, 'complete');
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'confirmed' where id = $1`, [id]); // owner bypass
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`update bookings set status = 'completed' where id = $1`, [id]);
    await db.asOwner();
    expect(await status(db, id)).toBe('completed');
  });

  it('rejects a forbidden status transition (staff cannot confirm a booking)', async () => {
    const { id } = await makeBooking(db, 'confirm');
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      db.pg.query(`update bookings set status = 'confirmed' where id = $1`, [id]),
    ).rejects.toThrow(/forbidden_booking_status_transition/);
    await db.asOwner();
  });

  it('silently pins payment_state — staff cannot mark a booking paid', async () => {
    const { id } = await makeBooking(db, 'paid');
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`update bookings set payment_state = 'paid' where id = $1`, [id]);
    await db.asOwner();
    expect(await paymentState(db, id)).toBe('pending'); // forgery neutralised
  });

  it('silently pins financial columns — staff cannot rewrite the total', async () => {
    const { id } = await makeBooking(db, 'total');
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`update bookings set total_minor = 1 where id = $1`, [id]);
    await db.asOwner();
    const { rows } = await db.pg.query<{ total_minor: number | string }>(
      `select total_minor from bookings where id = $1`,
      [id],
    );
    expect(Number(rows[0]!.total_minor)).toBe(7500);
  });

  it('allows staff to edit the internal note', async () => {
    const { id } = await makeBooking(db, 'note');
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`update bookings set notes = 'called the guest' where id = $1`, [id]);
    await db.asOwner();
    const { rows } = await db.pg.query<{ notes: string }>(`select notes from bookings where id = $1`, [
      id,
    ]);
    expect(rows[0]!.notes).toBe('called the guest');
  });

  it('blocks staff from fabricating a payments row directly', async () => {
    const { id } = await makeBooking(db, 'forge-pay');
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      db.pg.query(
        `insert into payments (booking_id, idempotency_key, amount_minor, status, paid_minor)
         values ($1, 'forged', 7500, 'paid', 7500)`,
        [id],
      ),
    ).rejects.toThrow(/forbidden_direct_write/);
    await db.asOwner();
  });

  it('F14: cancelling a PAID booking is routed to refund_pending, not a bare cancelled', async () => {
    const { id } = await makeBooking(db, 'paid-cancel');
    // Owner brings it to confirmed + paid (the webhook/ledger path).
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'confirmed', payment_state = 'paid' where id = $1`, [id]);

    // Staff "cancel" → the guard reroutes it so the refund owed is tracked.
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`update bookings set status = 'cancelled' where id = $1`, [id]);
    await db.asOwner();

    expect(await status(db, id)).toBe('refund_pending');
    expect(await paymentState(db, id)).toBe('paid'); // money still recorded as held until refunded
  });

  it('cancelling an UNPAID booking still cancels normally', async () => {
    const { id } = await makeBooking(db, 'unpaid-cancel');
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`update bookings set status = 'cancelled' where id = $1`, [id]);
    await db.asOwner();
    expect(await status(db, id)).toBe('cancelled');
  });
});
