import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STAFF = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('row level security', () => {
  let db: TestDb;
  let publishedActivityId: string;
  let draftActivityId: string;
  let bookingId: string;
  let paymentId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();

    // users + profiles
    for (const id of [USER_A, USER_B, STAFF]) {
      await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@example.com`]);
    }
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [USER_A]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [USER_B]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff')`, [STAFF]);

    // a published activity (via seed) and a draft activity
    const seeded = await seedOccurrence(db, 10);
    publishedActivityId = seeded.activityId;
    const { rows: draft } = await db.pg.query<{ id: string }>(
      `insert into activities (operator_id, slug, title, category, status)
       values ($1, 'draft-secret', 'Draft Secret', 'Island tours', 'draft') returning id`,
      [seeded.operatorId],
    );
    draftActivityId = draft[0]!.id;

    // a booking owned by USER_A + a payment with one event
    const { rows: b } = await db.pg.query<{ id: string }>(
      `insert into bookings (user_id, customer_name, customer_email, total_minor, status)
       values ($1, 'Asha', 'asha@example.com', 7500, 'confirmed') returning id`,
      [USER_A],
    );
    bookingId = b[0]!.id;
    const { rows: p } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor) values ($1, 'rls-pay', 7500) returning id`,
      [bookingId],
    );
    paymentId = p[0]!.id;
    await db.pg.query(
      `insert into payment_events (payment_id, type, provider_event_id, amount_minor) values ($1, 'paid', 'rls-evt', 7500)`,
      [paymentId],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('anon reads published activities but not drafts', async () => {
    await db.as(null);
    const { rows: pub } = await db.pg.query(`select id from activities where id = $1`, [publishedActivityId]);
    expect(pub).toHaveLength(1);
    const { rows: draft } = await db.pg.query(`select id from activities where id = $1`, [draftActivityId]);
    expect(draft).toHaveLength(0);
  });

  it('customers see only their own bookings', async () => {
    await db.as({ sub: USER_A, role: 'authenticated' });
    const { rows: own } = await db.pg.query(`select id from bookings where id = $1`, [bookingId]);
    expect(own).toHaveLength(1);

    await db.as({ sub: USER_B, role: 'authenticated' });
    const { rows: notMine } = await db.pg.query(`select id from bookings where id = $1`, [bookingId]);
    expect(notMine).toHaveLength(0);

    await db.as(null);
    const { rows: anon } = await db.pg.query(`select id from bookings where id = $1`, [bookingId]);
    expect(anon).toHaveLength(0);
  });

  it('staff see all bookings and draft activities', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const { rows: booking } = await db.pg.query(`select id from bookings where id = $1`, [bookingId]);
    expect(booking).toHaveLength(1);
    const { rows: draft } = await db.pg.query(`select id from activities where id = $1`, [draftActivityId]);
    expect(draft).toHaveLength(1);
  });

  it('payment_events is append-only (no update/delete via the API)', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      db.pg.query(`update payment_events set type = 'tampered' where payment_id = $1`, [paymentId]),
    ).rejects.toThrow();
    await expect(
      db.pg.query(`delete from payment_events where payment_id = $1`, [paymentId]),
    ).rejects.toThrow();
  });

  it('a customer cannot read another customer payment, but the owner can', async () => {
    await db.as({ sub: USER_B, role: 'authenticated' });
    const { rows: hidden } = await db.pg.query(`select id from payments where id = $1`, [paymentId]);
    expect(hidden).toHaveLength(0);

    await db.as({ sub: USER_A, role: 'authenticated' });
    const { rows: visible } = await db.pg.query(`select id from payments where id = $1`, [paymentId]);
    expect(visible).toHaveLength(1);
  });

  it('anyone may capture a lead', async () => {
    await db.as(null);
    await expect(
      db.pg.query(`insert into leads (name, contact) values ('Walk-in', 'walkin@example.com')`),
    ).resolves.toBeTruthy();
  });
});
