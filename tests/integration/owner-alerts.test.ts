// Owner alerts must resolve real contact details from env, so pin them BEFORE anything can call
// (and cache) getServerEnv in this file's module registry.
process.env.OWNER_WHATSAPP_TO = '23057729919';
process.env.OWNER_NOTIFY_EMAIL = 'owner-alerts@bellemaretours.test';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';
import { pgliteRpc } from '../db/rpc';
import { drainNotifications } from '@/lib/services/notifications';
import type { NotificationMessage, NotificationProvider } from '@/lib/notifications/types';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';

/**
 * Owner booking alerts (migration 20260804000000): a booking flipping to `confirmed` must alert the
 * OWNER — an email + a WhatsApp outbox row (recipient sentinel 'owner', resolved from env at send
 * time) and an in-app `admin_new_booking` feed row for every staff/admin profile — alongside the
 * existing customer confirmation. Born from a real incident: a tourist paid, the customer email went
 * out, and the owner learned about it days later from the dashboard.
 */
const STAFF = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1';
const ADMIN = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const CUSTOMER = 'b3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3';

class CapturingProvider implements NotificationProvider {
  readonly name = 'capturing';
  messages: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<void> {
    this.messages.push({ ...message });
  }
}

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [JSON.stringify(params)]);
  return rows[0]!.data;
}

describe('owner booking alerts', () => {
  let db: TestDb;
  let bookingId: string;
  let ref: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2), ($3)`, [STAFF, ADMIN, CUSTOMER]);
    await db.pg.query(
      `insert into profiles (id, role) values ($1, 'staff'), ($2, 'admin'), ($3, 'customer')`,
      [STAFF, ADMIN, CUSTOMER],
    );

    const seed = await seedOccurrence(db, 10);
    const slug = (
      await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [seed.activityId])
    ).rows[0]!.slug;
    const booked = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId: seed.occurrenceId,
      expectedSlug: slug,
      party: { Adult: 3 },
      customerName: 'Miguel Rueda',
      customerEmail: 'miguel@example.com',
      source: 'web',
      idempotencyKey: 'owner-alerts-1',
    });
    ref = booked.ref;
    bookingId = (
      await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [ref])
    ).rows[0]!.id;
    // Flip to confirmed (the AFTER UPDATE OF status trigger is the unit under test).
    await db.pg.query(`update bookings set status = 'confirmed' where id = $1`, [bookingId]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('confirmation enqueues the owner email + WhatsApp rows with the owner sentinel', async () => {
    await db.asOwner();
    const rows = (
      await db.pg.query<{ channel: string; recipient: string; template: string }>(
        `select channel, recipient, template from notification_outbox where booking_id = $1 order by channel, template`,
        [bookingId],
      )
    ).rows;
    expect(rows).toEqual([
      { channel: 'email', recipient: 'miguel@example.com', template: 'booking_confirmation' },
      { channel: 'email', recipient: 'owner', template: 'owner_new_booking' },
      { channel: 'whatsapp', recipient: 'owner', template: 'owner_new_booking' },
    ]);
  });

  it('lights the bell for every staff/admin profile — and never for a customer', async () => {
    await db.asOwner();
    const feed = (
      await db.pg.query<{ user_id: string }>(
        `select user_id from notifications where type = 'admin_new_booking' and data ->> 'bookingId' = $1`,
        [bookingId],
      )
    ).rows.map((r) => r.user_id);
    expect([...feed].sort()).toEqual([STAFF, ADMIN].sort());
    expect(feed).not.toContain(CUSTOMER);
  });

  it('re-confirming the same booking never duplicates the alerts', async () => {
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'payment_pending' where id = $1`, [bookingId]);
    await db.pg.query(`update bookings set status = 'confirmed' where id = $1`, [bookingId]);
    const outboxCount = (
      await db.pg.query<{ n: number }>(
        `select count(*)::int as n from notification_outbox where booking_id = $1 and template = 'owner_new_booking'`,
        [bookingId],
      )
    ).rows[0]!.n;
    expect(outboxCount).toBe(2); // one email + one whatsapp, not four
    const feedCount = (
      await db.pg.query<{ n: number }>(
        `select count(*)::int as n from notifications where type = 'admin_new_booking' and data ->> 'bookingId' = $1`,
        [bookingId],
      )
    ).rows[0]!.n;
    expect(feedCount).toBe(2); // staff + admin, not four
  });

  it('the drain resolves the owner recipients from env and enriches both alerts', async () => {
    await db.asOwner();
    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date('2026-07-10T08:00:00Z'),
    };
    const provider = new CapturingProvider();
    const result = await drainNotifications(ctx, provider, 20);
    expect(result).toEqual({ processed: 3, sent: 3, failed: 0 });

    const ownerEmail = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'email',
    )!;
    expect(ownerEmail.recipient).toBe('owner-alerts@bellemaretours.test');
    expect(ownerEmail.subject).toContain('New paid booking');
    expect(ownerEmail.text).toContain(ref);
    expect(ownerEmail.text).toContain('Miguel Rueda');
    expect(ownerEmail.html).toContain('/admin/bookings?q=');

    const wa = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'whatsapp',
    )!;
    expect(wa.recipient).toBe('23057729919');
    expect(wa.text).toContain(ref);
    expect(wa.text).toContain('3 guests');
  });
});
