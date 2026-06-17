import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { StubNotificationProvider } from '@/lib/notifications/stub';
import { drainNotifications } from '@/lib/services/notifications';

/**
 * End-to-end money path, exactly as the UI + webhook drive it:
 *   availability → api_book → api_create_payment → append_payment_event ('paid') → confirmed.
 * Booking is done AS THE SIGNED-IN CUSTOMER; the webhook append is done AS SERVICE-ROLE
 * (mirroring app/api/v1/webhooks/payments). Confirms the booking links to the user, the
 * payment state projects onto the booking, and availability decrements.
 */
const CUSTOMER = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('booking flow: availability → book → pay → webhook → confirmed', () => {
  let db: TestDb;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`);
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);

    // An activity with an option + price + one future occurrence (capacity 20) — as the admin
    // would create via the activity form + availability editor.
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'flow-tour', 'activity', 'Flow Tour', 'Sightseeing tours', 'published') returning id`,
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
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
       values ($1, 'Adult', 7000, null)`,
      [optId],
    );
    occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '2 days', now() + interval '2 days 4 hours', 20) returning id`,
        [optId, operatorId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('a signed-in customer books, the webhook confirms it, and availability drops', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string; status: string; paymentState: string; totalEur: number }>(
      db,
      'api_book',
      {
        occurrenceId,
        party: { Adult: 2 },
        customerName: 'Test Traveller',
        customerEmail: 'test@example.com',
        customerPhone: null,
        source: 'web',
        idempotencyKey: 'flow-key-12345678',
      },
    );
    expect(booking.status).toBe('payment_pending');
    expect(booking.totalEur).toBe(140); // 2 × €70

    const payment = await call<{ paymentId: string; amountMinor: number }>(db, 'api_create_payment', {
      bookingRef: booking.ref,
      idempotencyKey: 'flow-pay-12345678',
    });
    expect(payment.amountMinor).toBe(14000);

    // The webhook (service-role) appends the verified 'paid' event → confirms the booking.
    await db.as({ sub: 'service', role: 'service_role' });
    await db.pg.query(`select append_payment_event($1::uuid, 'paid', 'evt-flow-1', $2::int, now(), '{}'::jsonb)`, [
      payment.paymentId,
      payment.amountMinor,
    ]);

    // The customer now sees a confirmed, paid booking.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const status = await call<{ status: string; paymentState: string }>(db, 'api_get_booking', {
      ref: booking.ref,
    });
    expect(status.status).toBe('confirmed');
    expect(status.paymentState).toBe('paid');

    // Availability dropped by 2 (the public sees the reduced seat count).
    await db.as(null);
    const slots = await call<Array<{ occurrenceId: string; seatsLeft: number }>>(db, 'api_list_availability', {
      slug: 'flow-tour',
    });
    expect(slots.find((s) => s.occurrenceId === occurrenceId)?.seatsLeft).toBe(18);
  });

  it('saves and returns a custom itinerary on the booking', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const route = [
      { title: 'Port Louis', area: 'Capital', lat: -20.16, lng: 57.5 },
      { title: 'Fort Adelaide', area: 'Port Louis' },
    ];
    const booking = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 1 },
      itinerary: route,
      customerName: 'Route Tester',
      customerEmail: 'route@example.com',
      source: 'web',
      idempotencyKey: 'flow-route-12345678',
    });
    const got = await call<{ customItinerary: typeof route | null }>(db, 'api_get_booking', {
      ref: booking.ref,
    });
    expect(got.customItinerary).toHaveLength(2);
    expect(got.customItinerary![1]!.title).toBe('Fort Adelaide');

    // A booking with no itinerary returns null.
    const plain = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 1 },
      customerName: 'No Route',
      customerEmail: 'noroute@example.com',
      source: 'web',
      idempotencyKey: 'flow-noroute-1234567',
    });
    const got2 = await call<{ customItinerary: unknown }>(db, 'api_get_booking', { ref: plain.ref });
    expect(got2.customItinerary).toBeNull();
  });

  it('saves and returns the pickup location on the booking (trimmed; null when absent)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 1 },
      pickupLocation: '  Flic en Flac, Le Cardinal Villa  ',
      customerName: 'Pickup Tester',
      customerEmail: 'pickup@example.com',
      source: 'web',
      idempotencyKey: 'flow-pickup-12345678',
    });
    const got = await call<{ pickupLocation: string | null }>(db, 'api_get_booking', { ref: booking.ref });
    expect(got.pickupLocation).toBe('Flic en Flac, Le Cardinal Villa');

    // A booking with no pickup location returns null.
    const plain = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 1 },
      customerName: 'No Pickup',
      customerEmail: 'nopickup@example.com',
      source: 'web',
      idempotencyKey: 'flow-nopickup-1234567',
    });
    const got2 = await call<{ pickupLocation: unknown }>(db, 'api_get_booking', { ref: plain.ref });
    expect(got2.pickupLocation).toBeNull();
  });

  it('api_create_hold reserves N seats by mode, and api_book reuses the hold', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const hold = await call<{ holdId: string; quantity: number; expiresAt: string }>(db, 'api_create_hold', {
      occurrenceId,
      people: 3,
      idempotencyKey: 'hold-pp-1',
    });
    expect(hold.quantity).toBe(3);
    expect(hold.holdId).toBeTruthy();

    const before = (
      await db.pg.query<{ n: number }>(
        `select count(*)::int as n from booking_holds where session_occurrence_id = $1`,
        [occurrenceId],
      )
    ).rows[0]!.n;

    const booking = await call<{ ref: string; totalEur: number }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 3 },
      holdId: hold.holdId,
      customerName: 'Reuse',
      customerEmail: 'reuse@example.com',
      source: 'web',
      idempotencyKey: 'hold-pp-book',
    });
    expect(booking.totalEur).toBe(210); // 3 × €70

    const after = (
      await db.pg.query<{ n: number }>(
        `select count(*)::int as n from booking_holds where session_occurrence_id = $1`,
        [occurrenceId],
      )
    ).rows[0]!.n;
    expect(after).toBe(before); // api_book REUSED the hold — it did not create a second one
  });

  it('an EXPIRED Continue hold does not hard-lock the booking (fallback uses a distinct key)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    // Mirror the real key flow: the Continue hold's key is `<K>:hold`; the booking key is `<K>`.
    const hold = await call<{ holdId: string }>(db, 'api_create_hold', {
      occurrenceId,
      people: 2,
      idempotencyKey: 'collide-key-1:hold',
    });
    // The customer lingered past the hold TTL — expire the Continue hold.
    await db.asOwner();
    await db.pg.query(`update booking_holds set expires_at = now() - interval '1 minute' where id = $1`, [
      hold.holdId,
    ]);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    // api_book must NOT reuse the expired hold and must NOT collide with its key → it books fine.
    const booking = await call<{ totalEur: number }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 2 },
      holdId: hold.holdId,
      customerName: 'Lingerer',
      customerEmail: 'linger@example.com',
      source: 'web',
      idempotencyKey: 'collide-key-1',
    });
    expect(booking.totalEur).toBe(140); // booked at the fresh hold, not hard-locked
  });

  it('rejects a booking beyond remaining capacity', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      db.pg.query(`select api_book($1::jsonb)`, [
        JSON.stringify({
          occurrenceId,
          party: { Adult: 100 },
          customerName: 'Greedy',
          customerEmail: 'greedy@example.com',
          source: 'web',
          idempotencyKey: 'over-key-12345678',
        }),
      ]),
    ).rejects.toThrow();
  });

  it('the webhook append is idempotent — a duplicate event does not double-credit', async () => {
    await db.asOwner();
    const { rows } = await db.pg.query<{ paid_minor: number; status: string }>(
      `select p.paid_minor, b.status from payments p
       join bookings b on b.id = p.booking_id
       where b.ref = (select ref from bookings where customer_email = 'test@example.com' limit 1)`,
    );
    const before = rows[0]!;
    // Re-deliver the SAME provider event id.
    const { rows: pr } = await db.pg.query<{ id: string; amount_minor: number }>(
      `select p.id, p.amount_minor from payments p
       join bookings b on b.id = p.booking_id where b.customer_email = 'test@example.com' limit 1`,
    );
    await db.as({ sub: 'service', role: 'service_role' });
    await db.pg.query(`select append_payment_event($1::uuid, 'paid', 'evt-flow-1', $2::int, now(), '{}'::jsonb)`, [
      pr[0]!.id,
      pr[0]!.amount_minor,
    ]);
    await db.asOwner();
    const after = (
      await db.pg.query<{ paid_minor: number }>(`select paid_minor from payments where id = $1`, [pr[0]!.id])
    ).rows[0]!;
    expect(after.paid_minor).toBe(before.paid_minor); // unchanged — not double-credited
  });

  it('confirming a booking enqueues a confirmation, and the drain marks it sent', async () => {
    await db.asOwner();
    // The first test confirmed the booking → the AFTER-UPDATE trigger enqueued exactly one row
    // (the idempotent re-append did not re-fire, since the status did not change again).
    const enqueued = (
      await db.pg.query<{ status: string; recipient: string }>(
        `select status, recipient from notification_outbox where template = 'booking_confirmation'`,
      )
    ).rows;
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.status).toBe('pending');
    expect(enqueued[0]!.recipient).toBe('test@example.com');

    // Drain with the no-op stub provider → the row is marked sent.
    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    };
    const result = await drainNotifications(ctx, new StubNotificationProvider());
    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });

    const sent = (
      await db.pg.query<{ status: string; sent_at: string | null }>(
        `select status, sent_at from notification_outbox where template = 'booking_confirmation'`,
      )
    ).rows[0]!;
    expect(sent.status).toBe('sent');
    expect(sent.sent_at).not.toBeNull();
  });
});
