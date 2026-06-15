import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

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
         values ($1, 'flow-tour', 'activity', 'Flow Tour', 'Island tours', 'published') returning id`,
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
});
