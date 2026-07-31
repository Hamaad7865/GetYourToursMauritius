// Owner alerts must resolve real contact details from env, so pin them BEFORE anything can call
// (and cache) getServerEnv in this file's module registry.
process.env.TELEGRAM_OWNER_CHAT_ID = '-1002233445566';
process.env.OWNER_NOTIFY_EMAIL = 'owner-alerts@bellemaretours.test';
process.env.OWNER_WHATSAPP_TO = '23057729919';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { seedOccurrence } from '../db/seed';
import { pgliteRpc } from '../db/rpc';
import { drainNotifications } from '@/lib/services/notifications';
import type { NotificationMessage, NotificationProvider } from '@/lib/notifications/types';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';

/**
 * Owner booking alerts (migration 20260804000000; chat channel moved WhatsApp→Telegram in
 * 20260810000001, WhatsApp revived alongside it in 20260817000000): a booking flipping to `confirmed`
 * must alert the OWNER — an email + a Telegram + a WhatsApp outbox row (recipient sentinel 'owner',
 * resolved from env at send time) and an in-app `admin_new_booking` feed row for every staff/admin
 * profile — alongside the existing customer confirmation. Born from a real incident:
 * a tourist paid, the customer email went out, and the owner learned about it days later.
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

describe('owner booking alerts', () => {
  let db: TestDb;
  let bookingId: string;
  let ref: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2), ($3)`, [
      STAFF,
      ADMIN,
      CUSTOMER,
    ]);
    await db.pg.query(
      `insert into profiles (id, role) values ($1, 'staff'), ($2, 'admin'), ($3, 'customer')`,
      [STAFF, ADMIN, CUSTOMER],
    );

    const seed = await seedOccurrence(db, 10);
    const slug = (
      await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [
        seed.activityId,
      ])
    ).rows[0]!.slug;
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: seed.occurrenceId,
      expectedSlug: slug,
      party: { Adult: 3 },
      customerName: 'Miguel Rueda',
      customerEmail: 'miguel@example.com',
      source: 'web',
      idempotencyKey: 'owner-alerts-1',
    });
    ref = booked.ref;
    bookingId = (await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [ref]))
      .rows[0]!.id;
    // Flip to confirmed (the AFTER UPDATE OF status trigger is the unit under test).
    await db.pg.query(`update bookings set status = 'confirmed' where id = $1`, [bookingId]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('confirmation enqueues the owner email + Telegram + WhatsApp rows with the owner sentinel', async () => {
    await db.asOwner();
    const rows = (
      await db.pg.query<{ channel: string; recipient: string; template: string }>(
        `select channel, recipient, template from notification_outbox where booking_id = $1 order by channel, template`,
        [bookingId],
      )
    ).rows;
    // order by channel, template — notification_channel is an ENUM, so it sorts by declaration
    // order ('email', 'whatsapp', then the later-added 'telegram'), not alphabetically.
    expect(rows).toEqual([
      { channel: 'email', recipient: 'miguel@example.com', template: 'booking_confirmation' },
      { channel: 'email', recipient: 'owner', template: 'owner_new_booking' },
      { channel: 'whatsapp', recipient: 'owner', template: 'owner_new_booking' },
      { channel: 'telegram', recipient: 'owner', template: 'owner_new_booking' },
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
    expect(outboxCount).toBe(3); // one email + one telegram + one whatsapp, not six
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
      locale: 'en',
    };
    const provider = new CapturingProvider();
    const result = await drainNotifications(ctx, provider, 20);
    expect(result).toEqual({ processed: 4, sent: 4, failed: 0 });

    const ownerEmail = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'email',
    )!;
    expect(ownerEmail.recipient).toBe('owner-alerts@bellemaretours.test');
    expect(ownerEmail.subject).toContain('New paid booking');
    expect(ownerEmail.text).toContain(ref);
    expect(ownerEmail.text).toContain('Miguel Rueda');
    expect(ownerEmail.html).toContain('/admin/bookings?q=');

    const tg = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'telegram',
    )!;
    expect(tg.recipient).toBe('-1002233445566');
    expect(tg.text).toContain(ref);
    expect(tg.text).toContain('3 guests');

    const wa = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'whatsapp',
    )!;
    expect(wa.recipient).toBe('23057729919');
    expect(wa.text).toContain(ref);
    expect(wa.text).toContain('3 guests');
  });

  it('surfaces the customer phone + pickup location so the owner can actually reach the guest', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10);
    const slug = (
      await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [
        seed.activityId,
      ])
    ).rows[0]!.slug;
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: seed.occurrenceId,
      expectedSlug: slug,
      party: { Adult: 2 },
      customerName: 'Amina Patel',
      customerEmail: 'amina@example.com',
      customerPhone: '+230 5771 2345',
      pickupLocation: 'Le Touessrok Resort, room 214',
      source: 'web',
      idempotencyKey: 'owner-alerts-phone-1',
    });
    const phoneBookingId = (
      await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [booked.ref])
    ).rows[0]!.id;
    await db.pg.query(`update bookings set status = 'confirmed' where id = $1`, [phoneBookingId]);

    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date('2026-07-10T08:00:00Z'),
      locale: 'en',
    };
    const provider = new CapturingProvider();
    await drainNotifications(ctx, provider, 20);

    const ownerEmail = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'email',
    )!;
    expect(ownerEmail.text).toContain('Phone: +230 5771 2345');
    expect(ownerEmail.text).toContain('Pick-up: Le Touessrok Resort, room 214');
    expect(ownerEmail.html).toContain('href="tel:+230 5771 2345"');
    expect(ownerEmail.html).toContain('Le Touessrok Resort, room 214');

    const tg = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'telegram',
    )!;
    expect(tg.text).toContain('📞 +230 5771 2345');
  });

  it('spells out the age-band mix and the child seats — "4 guests" hides who needs a seat', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 10); // one 'Adult' tier; add the two child bands below
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, min_age, max_age, position)
       values ($1, 'Child', 2800, 3, 10, 1), ($1, 'Infant', 0, 0, 3, 2)`,
      [seed.optionId],
    );
    const slug = (
      await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [
        seed.activityId,
      ])
    ).rows[0]!.slug;
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: seed.occurrenceId,
      expectedSlug: slug,
      party: { Adult: 2, Child: 1, Infant: 1 },
      childSeats: 2,
      customerName: 'Klara Novak',
      customerEmail: 'klara@example.com',
      source: 'web',
      idempotencyKey: 'owner-alerts-bands-1',
    });
    const bandBookingId = (
      await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [booked.ref])
    ).rows[0]!.id;
    await db.pg.query(`update bookings set status = 'confirmed' where id = $1`, [bandBookingId]);

    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date('2026-07-10T08:00:00Z'),
      locale: 'en',
    };
    const provider = new CapturingProvider();
    await drainNotifications(ctx, provider, 20);

    const ownerEmail = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'email',
    )!;
    // The headcount alone ("4 guests") can't tell the owner a car seat and a free infant are coming.
    expect(ownerEmail.text).toContain('Party: ');
    for (const band of ['2 × Adult', '1 × Child', '1 × Infant']) {
      expect(ownerEmail.text).toContain(band);
      expect(ownerEmail.html).toContain(band);
    }
    expect(ownerEmail.text).toContain('Child seats: 2');

    const tg = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'telegram',
    )!;
    expect(tg.text).toContain('👥 2 × Adult');
    expect(tg.text).toContain('🧒 2 child seats');
  });

  it('carries an airport transfer’s baby-seat request, which never has a seat COUNT', async () => {
    await db.asOwner();
    // The airport form asks for a child seat as a toggle + the child's age and leaves child_seats at 0,
    // so a count-only alert would drop the request entirely.
    const operatorId = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Transfer Op', 'transfer-op-alerts') returning id`,
      )
    ).rows[0]!.id;
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode, is_airport_transfer)
         values ($1, 'airport-transfer-alerts', 'transport', 'Airport Transfer', 'Airport transfers', 'published', 'vehicle', true)
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    const optId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Per transfer') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
       values ($1, 'Transfer', 3600, null)`,
      [optId],
    );
    const occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '2 days', now() + interval '2 days 1 hour', 40) returning id`,
        [optId, operatorId],
      )
    ).rows[0]!.id;

    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      expectedSlug: 'airport-transfer-alerts',
      party: { Transfer: 2 },
      dropoffLocation: 'Shandrani Beachcomber Resort & Spa, Blue Bay',
      tripDirection: 'arrival',
      flightNumber: 'MK015',
      arrivalTime: '14:30',
      luggageDetails: '3 large suitcases',
      childSeatAge: 3,
      customerName: 'Yann Perrin',
      customerEmail: 'yann@example.com',
      source: 'web',
      idempotencyKey: 'owner-alerts-babyseat-1',
    });
    const seatBookingId = (
      await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [booked.ref])
    ).rows[0]!.id;
    await db.pg.query(`update bookings set status = 'confirmed' where id = $1`, [seatBookingId]);

    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date('2026-07-10T08:00:00Z'),
      locale: 'en',
    };
    const provider = new CapturingProvider();
    await drainNotifications(ctx, provider, 20);

    const ownerEmail = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'email',
    )!;
    expect(ownerEmail.text).toContain('Child seat: requested · child aged 3');
    expect(ownerEmail.text).toContain('Luggage: 3 large suitcases');

    const wa = provider.messages.find(
      (m) => m.template === 'owner_new_booking' && m.channel === 'whatsapp',
    )!;
    expect(wa.text).toContain('🧒 child seat requested · child aged 3');
  });
});
