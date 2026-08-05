import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';

/**
 * Late pickup: a booking taken with "I don't know yet" (pickup_pending) can be completed afterwards
 * by the guest, who pays the region transport supplement through a SECOND payments row.
 *
 * The invariants under test are the ones that decide whether money and the run sheet stay honest:
 *   - the address is NOT written until the supplement settles (otherwise the badge clears for free);
 *   - the supplement lands on transport_minor / total_minor / operator_payout_minor exactly once;
 *   - the add-on row never collides with the booking's own payment row (api_create_payment scoping);
 *   - a confirmed booking is still not re-payable as a BOOKING payment;
 *   - the stuck-checkout sweep can see an add-on (it enumerates bookings, which are confirmed here);
 *   - the 48h / 24h chase fires once per threshold and stops the moment a pickup exists.
 */

const CUSTOMER = 'c0ffee00-0000-4000-8000-000000000001';
const OTHER = 'c0ffee00-0000-4000-8000-000000000002';

/** North: lat >= -20.08. The activity boards here. */
const ACTIVITY_LAT = -20.0;
const ACTIVITY_LNG = 57.6;
/** South: lat <= -20.42. North↔South is seeded 'far' → sedan €50 for a party of 1–4. */
const SOUTH_LAT = -20.5;
const SOUTH_LNG = 57.5;
const FAR_SEDAN_MINOR = 5000;
/** Same region as the activity → 'same' band → sedan €15. */
const NORTH_LAT = -20.02;
const NORTH_LNG = 57.62;
const SAME_SEDAN_MINOR = 1500;

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

interface BookingRow {
  id: string;
  ref: string;
  pickup_location: string | null;
  dropoff_location: string | null;
  pickup_pending: boolean;
  pickup_region: string | null;
  transport_minor: number;
  total_minor: number;
  operator_payout_minor: number;
}

const bookingRow = async (db: TestDb, ref: string): Promise<BookingRow> =>
  (
    await db.pg.query<BookingRow>(
      `select id, ref, pickup_location, dropoff_location, pickup_pending, pickup_region,
              transport_minor, total_minor, operator_payout_minor
         from bookings where ref = $1`,
      [ref],
    )
  ).rows[0]!;

describe('late pickup: quote, pay the supplement, apply it', () => {
  let db: TestDb;
  let occurrenceId: string;
  let optionId: string;
  let operatorId: string;

  /** A confirmed + paid booking whose pickup is still to be arranged. */
  async function pendingPickupBooking(key: string, occ = occurrenceId): Promise<BookingRow> {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: occ,
      party: { Adult: 1 },
      pickupPending: true,
      customerName: 'Late Pickup Tester',
      customerEmail: `${key}@example.com`,
      source: 'web',
      idempotencyKey: `${key}-idem-0001`,
    });
    await db.asOwner();
    const row = await bookingRow(db, booked.ref);
    const { rows: p } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor, status, purpose)
       values ($1, $2, $3, 'pending', 'booking') returning id`,
      [row.id, `${key}-pay`, row.total_minor],
    );
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      p[0]!.id,
      `${key}-evt`,
      row.total_minor,
    ]);
    return bookingRow(db, booked.ref);
  }

  /** Drive an add-on payment to settled through the ledger, exactly as the webhook does. */
  async function settle(paymentId: string, amountMinor: number, eventId: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      paymentId,
      eventId,
      amountMinor,
    ]);
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    operatorId = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Late Pickup Tours', 'late-pickup-tours') returning id`,
      )
    ).rows[0]!.id;
    for (const id of [CUSTOMER, OTHER]) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
      await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [id]);
    }

    const activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pickup_available, lat, lng)
         values ($1, 'late-pickup-tour', 'activity', 'Late Pickup Tour', 'Sightseeing tours', 'published', true, $2, $3)
         returning id`,
        [operatorId, ACTIVITY_LAT, ACTIVITY_LNG],
      )
    ).rows[0]!.id;
    optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Shared') returning id`,
        [activityId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 7000)`,
      [optionId],
    );
    occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '10 days', now() + interval '10 days 4 hours', 40) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('quotes the far-region supplement without writing anything', async () => {
    const booking = await pendingPickupBooking('quote');
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const quote = await call<{ eligible: boolean; feeMinor: number; band: string; region: string }>(
      db,
      'api_quote_pickup_addon',
      { bookingRef: booking.ref, pickupLat: SOUTH_LAT, pickupLng: SOUTH_LNG },
    );
    expect(quote.eligible).toBe(true);
    expect(quote.band).toBe('far');
    expect(quote.region).toBe('South');
    expect(quote.feeMinor).toBe(FAR_SEDAN_MINOR);

    await db.asOwner();
    const { rows } = await db.pg.query<{ n: string }>(
      `select count(*) as n from booking_pickup_requests where booking_id = $1`,
      [booking.id],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('refuses to quote someone else’s booking', async () => {
    const booking = await pendingPickupBooking('foreign');
    await db.as({ sub: OTHER, role: 'authenticated' });
    await expect(
      call(db, 'api_quote_pickup_addon', {
        bookingRef: booking.ref,
        pickupLat: SOUTH_LAT,
        pickupLng: SOUTH_LNG,
      }),
    ).rejects.toThrow(/forbidden/);
  });

  it('parks the address until the supplement is paid, then applies it exactly once', async () => {
    const booking = await pendingPickupBooking('apply');
    const totalBefore = booking.total_minor;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ applied: boolean; feeMinor: number; paymentId: string }>(
      db,
      'api_request_pickup',
      {
        bookingRef: booking.ref,
        pickupLocation: 'Le Morne Beach Villa',
        dropoffLocation: 'Grand Baie',
        pickupLat: SOUTH_LAT,
        pickupLng: SOUTH_LNG,
      },
    );
    expect(req.applied).toBe(false);
    expect(req.feeMinor).toBe(FAR_SEDAN_MINOR);

    // NOT applied yet: the badge stays, the money has not moved.
    await db.asOwner();
    let row = await bookingRow(db, booking.ref);
    expect(row.pickup_pending).toBe(true);
    expect(row.pickup_location).toBeNull();
    expect(row.total_minor).toBe(totalBefore);

    // The add-on row is its own payment, at the quoted amount.
    const { rows: pay } = await db.pg.query<{ amount_minor: number; purpose: string }>(
      `select amount_minor, purpose from payments where id = $1`,
      [req.paymentId],
    );
    expect(pay[0]!.purpose).toBe('pickup_addon');
    expect(pay[0]!.amount_minor).toBe(FAR_SEDAN_MINOR);

    // The GUEST can see their own parked request through booking_json (which is `security invoker`,
    // so this is really a test of the RLS policy). Without it the booking page would show a bare
    // "to be arranged" badge and offer to charge them a second time for a pickup they already
    // committed to.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const mine = await call<{
      pickupPending: boolean;
      pickupLocation: string | null;
      pendingPickup: { pickupLocation: string; feeEur: number } | null;
    }>(db, 'api_get_booking', { ref: booking.ref });
    expect(mine.pickupPending).toBe(true);
    expect(mine.pickupLocation).toBeNull();
    expect(mine.pendingPickup?.pickupLocation).toBe('Le Morne Beach Villa');
    expect(mine.pendingPickup?.feeEur).toBe(FAR_SEDAN_MINOR / 100);

    await settle(req.paymentId, FAR_SEDAN_MINOR, 'apply-addon-evt');

    // …and it clears once applied — the signal the booking page polls on.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const applied = await call<{
      pickupLocation: string | null;
      pendingPickup: unknown | null;
    }>(db, 'api_get_booking', { ref: booking.ref });
    expect(applied.pendingPickup).toBeNull();
    expect(applied.pickupLocation).toBe('Le Morne Beach Villa');
    await db.asOwner();

    row = await bookingRow(db, booking.ref);
    expect(row.pickup_pending).toBe(false);
    expect(row.pickup_location).toBe('Le Morne Beach Villa');
    expect(row.dropoff_location).toBe('Grand Baie');
    expect(row.pickup_region).toBe('South');
    expect(row.transport_minor).toBe(FAR_SEDAN_MINOR);
    expect(row.total_minor).toBe(totalBefore + FAR_SEDAN_MINOR);
    expect(row.operator_payout_minor).toBe(booking.operator_payout_minor + FAR_SEDAN_MINOR);

    // A replayed provider event (webhook + reconcile + the customer's sync poll all land here) must
    // not add the supplement twice.
    await settle(req.paymentId, FAR_SEDAN_MINOR, 'apply-addon-evt-replay');
    const again = await bookingRow(db, booking.ref);
    expect(again.total_minor).toBe(totalBefore + FAR_SEDAN_MINOR);
    expect(again.transport_minor).toBe(FAR_SEDAN_MINOR);

    // The booking stays confirmed and paid — an add-on never re-runs the confirmation machinery.
    const { rows: st } = await db.pg.query<{ status: string; payment_state: string }>(
      `select status, payment_state from bookings where id = $1`,
      [booking.id],
    );
    expect(st[0]!.status).toBe('confirmed');
    expect(st[0]!.payment_state).toBe('paid');

    // Both parties are told.
    const { rows: notes } = await db.pg.query<{ template: string }>(
      `select template from notification_outbox where booking_id = $1 order by template`,
      [booking.id],
    );
    const templates = notes.map((n) => n.template);
    expect(templates).toContain('owner_pickup_set');
    expect(templates).toContain('pickup_confirmed');
    expect(templates.filter((t) => t === 'pickup_confirmed')).toHaveLength(1);
  });

  it('applies a zero-fee pickup immediately, with no payment at all', async () => {
    await db.asOwner();
    // The owner is entitled to zero out a band; when they have, there is nothing to charge and
    // nothing to wait for.
    await db.pg.query(`update transport_band_pricing set sedan_minor = 0 where band = 'same'`);
    const booking = await pendingPickupBooking('freefee');

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ applied: boolean; feeMinor: number; paymentId: string | null }>(
      db,
      'api_request_pickup',
      {
        bookingRef: booking.ref,
        pickupLocation: 'Grand Baie, Royal Palm',
        pickupLat: NORTH_LAT,
        pickupLng: NORTH_LNG,
      },
    );
    expect(req.applied).toBe(true);
    expect(req.feeMinor).toBe(0);
    expect(req.paymentId).toBeNull();

    await db.asOwner();
    const row = await bookingRow(db, booking.ref);
    expect(row.pickup_pending).toBe(false);
    expect(row.pickup_location).toBe('Grand Baie, Royal Palm');
    expect(row.total_minor).toBe(booking.total_minor);
    expect(row.transport_minor).toBe(0);
    await db.pg.query(`update transport_band_pricing set sedan_minor = $1 where band = 'same'`, [
      SAME_SEDAN_MINOR,
    ]);
  });

  it('revises an unpaid request in place instead of forking a second payable supplement', async () => {
    const booking = await pendingPickupBooking('revise');
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const first = await call<{ paymentId: string; feeMinor: number }>(db, 'api_request_pickup', {
      bookingRef: booking.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    expect(first.feeMinor).toBe(FAR_SEDAN_MINOR);

    const second = await call<{ paymentId: string; feeMinor: number }>(db, 'api_request_pickup', {
      bookingRef: booking.ref,
      pickupLocation: 'Grand Baie, Royal Palm',
      pickupLat: NORTH_LAT,
      pickupLng: NORTH_LNG,
    });
    // Same row, re-priced to the nearer band — not a second payable supplement.
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.feeMinor).toBe(SAME_SEDAN_MINOR);

    await db.asOwner();
    const { rows: open } = await db.pg.query<{ n: string }>(
      `select count(*) as n from booking_pickup_requests where booking_id = $1 and applied_at is null`,
      [booking.id],
    );
    expect(Number(open[0]!.n)).toBe(1);
    const { rows: addons } = await db.pg.query<{ n: string }>(
      `select count(*) as n from payments where booking_id = $1 and purpose = 'pickup_addon'`,
      [booking.id],
    );
    expect(Number(addons[0]!.n)).toBe(1);

    // Settling now charges the REVISED fare and applies the revised address.
    await settle(first.paymentId, SAME_SEDAN_MINOR, 'revise-addon-evt');
    const row = await bookingRow(db, booking.ref);
    expect(row.pickup_location).toBe('Grand Baie, Royal Palm');
    expect(row.transport_minor).toBe(SAME_SEDAN_MINOR);
  });

  it('keeps the booking itself unpayable, and never hands a booking re-pay the add-on row', async () => {
    const booking = await pendingPickupBooking('scoping');
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_request_pickup', {
      bookingRef: booking.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });

    // The booking is confirmed + paid: a 'booking' payment must still be refused outright, and the
    // refusal must not be softened by the add-on row now sitting on the same booking.
    await expect(
      call(db, 'api_create_payment', {
        bookingRef: booking.ref,
        idempotencyKey: 'scoping-repay-key',
      }),
    ).rejects.toThrow(/booking_not_payable/);

    // The add-on, by contrast, mints its checkout at the supplement amount.
    const link = await call<{ paymentId: string; amountMinor: number }>(db, 'api_create_payment', {
      bookingRef: booking.ref,
      idempotencyKey: 'scoping-addon-key',
      purpose: 'pickup_addon',
    });
    expect(link.amountMinor).toBe(FAR_SEDAN_MINOR);
  });

  it('lets the stuck-checkout sweep see an add-on on a confirmed booking', async () => {
    const booking = await pendingPickupBooking('sweep');
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: booking.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    await db.asOwner();
    await db.pg.query(
      `update payments set provider_checkout_id = 'chk_sweep_1', checkout_created_at = now() where id = $1`,
      [req.paymentId],
    );
    const found = await call<Array<{ ref: string; paymentId: string; checkoutId: string }>>(
      db,
      'api_pending_payment_checkouts',
      {},
    );
    expect(found.some((c) => c.paymentId === req.paymentId && c.checkoutId === 'chk_sweep_1')).toBe(
      true,
    );
  });

  it('chases a missing pickup at 48h and again at 24h, then stops once it is set', async () => {
    await db.asOwner();
    const occ48 = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '40 hours', now() + interval '44 hours', 10) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    const booking = await pendingPickupBooking('chase', occ48);

    await db.as({ role: 'service_role' });
    const first = await db.pg.query<{ n: number }>(
      `select api_enqueue_pickup_reminders('{}'::jsonb) as n`,
    );
    expect(first.rows[0]!.n).toBeGreaterThanOrEqual(1);

    await db.asOwner();
    const sent = async (): Promise<string[]> =>
      (
        await db.pg.query<{ idempotency_key: string }>(
          `select idempotency_key from notification_outbox
            where booking_id = $1 and idempotency_key like 'pickup%'
            order by idempotency_key`,
          [booking.id],
        )
      ).rows.map((r) => r.idempotency_key);

    // The key carries the DEPARTURE as well as the booking, so a reschedule re-arms the chase.
    expect(await sent()).toEqual([
      expect.stringMatching(new RegExp(`^pickup_reminder_48:${booking.id}:[0-9]{12}$`)),
    ]);

    // A second sweep inside the same window is a no-op — the guest is chased once per threshold.
    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_enqueue_pickup_reminders('{}'::jsonb)`);
    await db.asOwner();
    expect(await sent()).toHaveLength(1);

    // Inside 24 hours: the guest is chased again, and now the owner is told too.
    await db.pg.query(
      `update session_occurrences set starts_at = now() + interval '20 hours',
              ends_at = now() + interval '24 hours' where id = $1`,
      [occ48],
    );
    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_enqueue_pickup_reminders('{}'::jsonb)`);
    await db.asOwner();
    expect(await sent()).toEqual([
      expect.stringMatching(`^pickup_missing_owner:${booking.id}:`),
      expect.stringMatching(`^pickup_reminder_24:${booking.id}:`),
      expect.stringMatching(`^pickup_reminder_48:${booking.id}:`),
    ]);

    // Once a pickup exists there is nothing left to chase.
    await db.pg.query(
      `update bookings set pickup_location = 'Trou aux Biches', pickup_pending = false where id = $1`,
      [booking.id],
    );
    await db.as({ role: 'service_role' });
    const after = await db.pg.query<{ n: number }>(
      `select api_enqueue_pickup_reminders('{}'::jsonb) as n`,
    );
    await db.asOwner();
    const rows = await sent();
    expect(rows).toHaveLength(3);
    expect(after.rows[0]!.n).toBe(0);
  });
});
