import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';

/**
 * Regressions from the adversarial review of the late-pickup feature (20260910000000).
 *
 * Every case here is a defect that a second `payments` row on one booking created in code that
 * pre-dates it, or a hole in the new code itself. They are grouped in one file because they share an
 * expensive fixture (a confirmed + paid booking whose pickup is still to be arranged), and because the
 * thing they collectively pin down is a single claim: adding a second kind of money to a booking must
 * not disturb anything that reasons about "the booking's payment".
 */

const CUSTOMER = 'beef0000-0000-4000-8000-000000000001';
const STAFF = 'beef0000-0000-4000-8000-0000000000ff';

/** North: the activity boards here. South: the guest's pickup — 'far' band, sedan €50. */
const ACTIVITY_LAT = -20.0;
const ACTIVITY_LNG = 57.6;
const SOUTH_LAT = -20.5;
const SOUTH_LNG = 57.5;
const NORTH_LAT = -20.02;
const NORTH_LNG = 57.62;
const FAR_SEDAN_MINOR = 5000;

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('late pickup — regressions', () => {
  let db: TestDb;
  let occurrenceId: string;
  let optionId: string;
  let operatorId: string;
  let activityId: string;
  let seq = 0;

  interface Fixture {
    id: string;
    ref: string;
    totalMinor: number;
    bookingPaymentId: string;
  }

  /** A confirmed + paid booking whose pickup is still to be arranged. */
  async function booking(occ = occurrenceId): Promise<Fixture> {
    seq += 1;
    const key = `reg${seq}`;
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: occ,
      party: { Adult: 1 },
      pickupPending: true,
      customerName: 'Regression Tester',
      customerEmail: `${key}@example.com`,
      source: 'web',
      idempotencyKey: `${key}-idem-0001`,
    });
    await db.asOwner();
    const row = (
      await db.pg.query<{ id: string; total_minor: number }>(
        `select id, total_minor from bookings where ref = $1`,
        [booked.ref],
      )
    ).rows[0]!;
    const pay = (
      await db.pg.query<{ id: string }>(
        `insert into payments (booking_id, idempotency_key, amount_minor, status, purpose)
         values ($1, $2, $3, 'pending', 'booking') returning id`,
        [row.id, `${key}-pay`, row.total_minor],
      )
    ).rows[0]!.id;
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      pay,
      `${key}-evt`,
      row.total_minor,
    ]);
    return { id: row.id, ref: booked.ref, totalMinor: row.total_minor, bookingPaymentId: pay };
  }

  /** Commit to a far-region pickup and settle its supplement. Returns the add-on payment id. */
  async function addPaidPickup(b: Fixture, label: string): Promise<string> {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    await db.asOwner();
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      req.paymentId,
      `${label}-addon-evt`,
      FAR_SEDAN_MINOR,
    ]);
    return req.paymentId;
  }

  const state = async (id: string) =>
    (
      await db.pg.query<{ status: string; payment_state: string; total_minor: number }>(
        `select status, payment_state, total_minor from bookings where id = $1`,
        [id],
      )
    ).rows[0]!;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    operatorId = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Regression Tours', 'regression-tours') returning id`,
      )
    ).rows[0]!.id;
    for (const id of [CUSTOMER, STAFF]) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
    }
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [STAFF]);

    activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pickup_available, lat, lng)
         values ($1, 'regression-tour', 'activity', 'Regression Tour', 'Sightseeing tours', 'published', true, $2, $3)
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
         values ($1, $2, now() + interval '10 days', now() + interval '10 days 4 hours', 60) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  // ── The second row must not be mistaken for the booking's own payment ─────────────────────────

  it('marks EVERY row that holds money refunded, not just the newest', async () => {
    const b = await booking();
    const addon = await addPaidPickup(b, 'refund-all');
    await db.pg.query(`update bookings set status = 'refund_pending' where id = $1`, [b.id]);

    await db.as({ sub: STAFF, role: 'authenticated' });
    const res = await call<{ ok: boolean; paymentsReversed: number }>(db, 'api_mark_refunded', {
      bookingId: b.id,
    });
    expect(res.paymentsReversed).toBe(2);

    await db.asOwner();
    const rows = (
      await db.pg.query<{ purpose: string; status: string; refunded_minor: number }>(
        `select purpose, status, refunded_minor from payments where booking_id = $1 order by created_at`,
        [b.id],
      )
    ).rows;
    // Before the fix the loop was `order by created_at desc limit 1`: the €50 supplement was reversed
    // and the booking payment was left fully held, unrecoverably (the second click short-circuited).
    expect(rows.map((r) => r.status)).toEqual(['refunded', 'refunded']);
    expect(rows.find((r) => r.purpose === 'booking')!.refunded_minor).toBe(b.totalMinor);
    expect(rows.find((r) => r.purpose === 'pickup_addon')!.refunded_minor).toBe(FAR_SEDAN_MINOR);

    const after = await state(b.id);
    expect(after.status).toBe('refunded');
    expect(after.payment_state).toBe('refunded');
    expect(addon).toBeTruthy();

    // Idempotent: a repeat click is a no-op, judged on the whole booking rather than one row.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const again = await call<{ alreadyRefunded?: boolean }>(db, 'api_mark_refunded', {
      bookingId: b.id,
    });
    expect(again.alreadyRefunded).toBe(true);
  });

  it('is not blocked from refunding by an abandoned, never-paid supplement', async () => {
    const b = await booking();
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'refund_pending' where id = $1`, [b.id]);

    // Before the fix the 'pending' add-on row was the newest, and the
    // `status in ('paid','partially_refunded')` gate raised not_refundable — a guest who opened a
    // supplement checkout and walked away made their booking impossible to mark refunded.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const res = await call<{ paymentsReversed: number }>(db, 'api_mark_refunded', {
      bookingId: b.id,
    });
    expect(res.paymentsReversed).toBe(1);
    await db.asOwner();
    expect((await state(b.id)).status).toBe('refunded');
  });

  it('does not mark a live booking refunded when only the supplement is reversed', async () => {
    const b = await booking();
    const addon = await addPaidPickup(b, 'partial-refund');

    // The owner refunds ONLY the €50 supplement in Peach (the pickup could not be serviced). That is
    // a legitimate action; it must not touch the €70 trip the guest is still going on.
    await db.asOwner();
    await db.pg.query(`select append_payment_event($1, 'refunded', $2, $3, now(), '{}'::jsonb)`, [
      addon,
      'addon-refund-evt',
      FAR_SEDAN_MINOR,
    ]);

    const after = await state(b.id);
    expect(after.status).toBe('confirmed');
    expect(after.payment_state).toBe('paid');
    // …and the seats stay taken: the refunded branch also releases holds.
    const holds = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from booking_holds where booking_id = $1 and status = 'released'`,
        [b.id],
      )
    ).rows[0]!.n;
    expect(Number(holds)).toBe(0);
  });

  it('bills the invoice against the booking payment, with the supplement folded in', async () => {
    const b = await booking();
    await db.asOwner();
    await db.pg.query(
      `update payments set charged_amount_minor = 371000, charged_currency = 'MUR' where id = $1`,
      [b.bookingPaymentId],
    );
    const addon = await addPaidPickup(b, 'receipt');
    await db.pg.query(
      `update payments set charged_amount_minor = 265000, charged_currency = 'MUR' where id = $1`,
      [addon],
    );

    const receipt = await call<{
      payment: { chargedAmountMinor: number; chargedCurrency: string; providerRef: string };
      totalEur: number;
    }>(db, 'api_booking_receipt', { bookingId: b.id });

    // Before the fix this returned the ADD-ON row: MUR 2,650 against a €120 order, with the add-on's
    // provider ref and settlement date — a VAT document quoting a fabricated FX rate.
    expect(receipt.payment.providerRef).toContain('-evt');
    expect(receipt.payment.providerRef).not.toContain('addon');
    expect(receipt.payment.chargedAmountMinor).toBe(371000 + 265000);
    expect(receipt.payment.chargedCurrency).toBe('MUR');
    expect(receipt.totalEur).toBe((b.totalMinor + FAR_SEDAN_MINOR) / 100);
  });

  // ── Money in flight ───────────────────────────────────────────────────────────────────────────

  it('refuses to re-price a supplement while a checkout session is live', async () => {
    const b = await booking();
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const first = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    await db.asOwner();
    await db.pg.query(
      `update payments set provider_checkout_id = 'chk_live', checkout_created_at = now() where id = $1`,
      [first.paymentId],
    );

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      call(db, 'api_request_pickup', {
        bookingRef: b.ref,
        pickupLocation: 'Grand Baie, Royal Palm',
        pickupLat: NORTH_LAT,
        pickupLng: NORTH_LNG,
      }),
    ).rejects.toThrow(/pickup_payment_in_flight/);
  });

  it('refuses to revise while another request holds the single-flight checkout lease', async () => {
    const b = await booking();
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const first = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    // The state during the ~2s the edge worker is out at Peach: lease stamped, session id not back
    // yet. The guard used to look only at provider_checkout_id, so a revise in this window re-priced
    // the row AND cleared the lease — the loser then minted a second payable session.
    await db.asOwner();
    await db.pg.query(
      `update payments set checkout_claimed_until = now() + interval '90 seconds' where id = $1`,
      [first.paymentId],
    );

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      call(db, 'api_request_pickup', {
        bookingRef: b.ref,
        pickupLocation: 'Grand Baie, Royal Palm',
        pickupLat: NORTH_LAT,
        pickupLng: NORTH_LNG,
      }),
    ).rejects.toThrow(/pickup_payment_in_flight/);

    await db.asOwner();
    const lease = (
      await db.pg.query<{ checkout_claimed_until: string | null }>(
        `select checkout_claimed_until from payments where id = $1`,
        [first.paymentId],
      )
    ).rows[0]!;
    expect(lease.checkout_claimed_until).not.toBeNull();
  });

  it('refuses a zero-fee revision while the previous supplement is still payable', async () => {
    const b = await booking();
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const first = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    await db.asOwner();
    await db.pg.query(`update transport_band_pricing set sedan_minor = 0 where band = 'same'`);
    await db.pg.query(
      `update payments set provider_checkout_id = 'chk_zero', checkout_created_at = now() where id = $1`,
      [first.paymentId],
    );

    // The zero-fee path applies immediately and stamps applied_at. Without this guard the live
    // session stayed payable and its capture would be silently discarded by the trigger — money
    // taken for a pickup already applied for free.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      call(db, 'api_request_pickup', {
        bookingRef: b.ref,
        pickupLocation: 'Grand Baie, Royal Palm',
        pickupLat: NORTH_LAT,
        pickupLng: NORTH_LNG,
      }),
    ).rejects.toThrow(/pickup_payment_in_flight/);

    await db.asOwner();
    expect(
      (
        await db.pg.query<{ pickup_pending: boolean }>(
          `select pickup_pending from bookings where id = $1`,
          [b.id],
        )
      ).rows[0]!.pickup_pending,
    ).toBe(true);
    await db.pg.query(`update transport_band_pricing set sedan_minor = 1500 where band = 'same'`);
  });

  it('does not apply a pickup to a booking that is no longer live', async () => {
    const b = await booking();
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    // The guest cancels; a session minted beforehand is still completable at Peach for ~30 minutes.
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'cancelled' where id = $1`, [b.id]);
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      req.paymentId,
      'late-addon-evt',
      FAR_SEDAN_MINOR,
    ]);

    const after = (
      await db.pg.query<{
        pickup_location: string | null;
        transport_minor: number;
        status: string;
      }>(`select pickup_location, transport_minor, status from bookings where id = $1`, [b.id])
    ).rows[0]!;
    expect(after.pickup_location).toBeNull();
    expect(after.transport_minor).toBe(0);
    // append_payment_event's own "money on a non-live booking" branch owns the outcome.
    expect(after.status).toBe('refund_pending');
  });

  // ── Privacy ───────────────────────────────────────────────────────────────────────────────────

  it('erases the pickup address from the request rows, not just from the booking', async () => {
    const b = await booking();
    await addPaidPickup(b, 'gdpr');

    await db.asOwner();
    await db.pg.query(`update bookings set user_id = $1 where id = $2`, [CUSTOMER, b.id]);
    // Staff-initiated erasure (the /admin path): is_staff() satisfies the gate and the email is read
    // from the payload rather than from the caller's own auth.users row.
    await db.as({ sub: STAFF, role: 'authenticated' });
    await call(db, 'api_erase_user', { userId: CUSTOMER, email: `reg${seq}@example.com` });

    await db.asOwner();
    const row = (
      await db.pg.query<{
        pickup_location: string | null;
        pickup_lat: number | null;
        dropoff_location: string | null;
        fee_minor: number;
        applied_at: string | null;
      }>(
        `select pickup_location, pickup_lat, dropoff_location, fee_minor, applied_at
           from booking_pickup_requests where booking_id = $1`,
        [b.id],
      )
    ).rows[0]!;
    // The request row carries its own copy of the street address AND the guest's GPS coordinates.
    // Nulling bookings.pickup_location left that copy behind forever.
    expect(row.pickup_location).toBeNull();
    expect(row.pickup_lat).toBeNull();
    expect(row.dropoff_location).toBeNull();
    // …but the row SURVIVES: api_booking_receipt reads applied_at as its proof that the settled
    // supplement belongs on the invoice, and the fare stays in total_minor for good. Deleting it made
    // the retained VAT record report a charge smaller than its own line items.
    expect(row.applied_at).not.toBeNull();
    expect(row.fee_minor).toBe(FAR_SEDAN_MINOR);
    const bk = (
      await db.pg.query<{ pickup_location: string | null; transport_minor: number }>(
        `select pickup_location, transport_minor from bookings where id = $1`,
        [b.id],
      )
    ).rows[0]!;
    expect(bk.pickup_location).toBeNull();
    // …while the money trail survives, which is the whole point of anonymize-with-retention.
    expect(bk.transport_minor).toBe(FAR_SEDAN_MINOR);
  });

  // ── The chase ─────────────────────────────────────────────────────────────────────────────────

  it('is reachable through the single-jsonb RPC convention the cron actually uses', async () => {
    await db.asOwner();
    const overloads = (
      await db.pg.query<{ args: string }>(
        `select pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'api_enqueue_pickup_reminders'`,
      )
    ).rows.map((r) => r.args);
    // A niladic sweep is invisible to PostgREST through the shared adapter, which calls every api_*
    // function as fn(p := jsonb) — the maintenance route then 503s forever and nothing is ever sent.
    // This is the exact bug 20260828000000_review_invites_p_arg.sql exists to fix.
    expect(overloads).toEqual(['p jsonb']);
  });

  it('never chases a guest for a pickup the flow would refuse to accept', async () => {
    await db.asOwner();
    const noPickupAct = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pickup_available, lat, lng)
         values ($1, 'no-pickup-tour', 'activity', 'No Pickup Tour', 'Sightseeing tours', 'published', false, $2, $3)
         returning id`,
        [operatorId, ACTIVITY_LAT, ACTIVITY_LNG],
      )
    ).rows[0]!.id;
    const opt = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Shared') returning id`,
        [noPickupAct],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 7000)`,
      [opt],
    );
    const occ = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '40 hours', now() + interval '44 hours', 10) returning id`,
        [opt, operatorId],
      )
    ).rows[0]!.id;
    const b = await booking(occ);

    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_enqueue_pickup_reminders('{}'::jsonb)`);
    await db.asOwner();
    // The booking page would answer 'transport_not_applicable' and leave the CTA disabled forever, so
    // mailing "add it now" twice and escalating to the owner is a demand nobody can satisfy.
    const rows = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from notification_outbox
          where booking_id = $1 and idempotency_key like 'pickup%'`,
        [b.id],
      )
    ).rows[0]!.n;
    expect(Number(rows)).toBe(0);
  });

  it('stops chasing — and stops selling — once the departure is called off', async () => {
    await db.asOwner();
    // Seeded far out and moved in AFTER booking: api_book enforces a minimum advance in MAURITIUS
    // CALENDAR DAYS, so seeding directly at +20h passes in the evening and raises occurrence_too_soon
    // after midnight — a test that fails depending on what time CI runs.
    const occ = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '10 days', now() + interval '10 days 4 hours', 10) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    const b = await booking(occ);
    await db.pg.query(
      `update session_occurrences
          set starts_at = now() + interval '20 hours', ends_at = now() + interval '24 hours',
              status = 'cancelled'
        where id = $1`,
      [occ],
    );

    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_enqueue_pickup_reminders('{}'::jsonb)`);
    await db.asOwner();
    const rows = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from notification_outbox
          where booking_id = $1 and idempotency_key like 'pickup%'`,
        [b.id],
      )
    ).rows[0]!.n;
    // "Tomorrow: where should we collect you?" hours after "your trip has been called off".
    expect(Number(rows)).toBe(0);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const quote = await call<{ eligible: boolean; reason: string }>(db, 'api_quote_pickup_addon', {
      bookingRef: b.ref,
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    expect(quote.eligible).toBe(false);
    expect(quote.reason).toBe('departure_cancelled');
  });

  it('re-arms the chase when a booking moves to a new date', async () => {
    await db.asOwner();
    const first = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '40 hours', now() + interval '44 hours', 10) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    const b = await booking(first);

    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_enqueue_pickup_reminders('{}'::jsonb)`);

    // The guest reschedules to a later date, still with no pickup. The booking id does not change, so
    // a booking-scoped idempotency key would suppress the new date's chase forever.
    await db.asOwner();
    const second = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '41 hours', now() + interval '45 hours', 10) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    await db.pg.query(`update booking_items set session_occurrence_id = $1 where booking_id = $2`, [
      second,
      b.id,
    ]);

    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_enqueue_pickup_reminders('{}'::jsonb)`);
    await db.asOwner();
    const keys = (
      await db.pg.query<{ idempotency_key: string }>(
        `select idempotency_key from notification_outbox
          where booking_id = $1 and idempotency_key like 'pickup_reminder_48:%'`,
        [b.id],
      )
    ).rows.map((r) => r.idempotency_key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  // ── Round 2: money we took but could not apply ────────────────────────────────────────────────

  it('refuses to apply a supplement to a departure we called off, and flags the money', async () => {
    await db.asOwner();
    const occ = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '10 days', now() + interval '10 days 4 hours', 10) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    const b = await booking(occ);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });

    // The owner calls the departure off. api_weather_cancel_occurrence leaves the booking
    // 'confirmed', so a status-only guard sails straight past it.
    await db.asOwner();
    await db.pg.query(`update session_occurrences set status = 'cancelled' where id = $1`, [occ]);
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      req.paymentId,
      'calledoff-addon-evt',
      FAR_SEDAN_MINOR,
    ]);

    const after = (
      await db.pg.query<{ pickup_location: string | null; transport_minor: number }>(
        `select pickup_location, transport_minor from bookings where id = $1`,
        [b.id],
      )
    ).rows[0]!;
    // Charged for transport to a trip we had just told them was cancelled.
    expect(after.pickup_location).toBeNull();
    expect(after.transport_minor).toBe(0);
    // …and the money is not silent: the owner is told to refund it.
    const alerts = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from notification_outbox
          where booking_id = $1 and template = 'owner_pickup_orphan_payment'`,
        [b.id],
      )
    ).rows[0]!.n;
    expect(Number(alerts)).toBe(1);
  });

  it('applies a supplement that settles late on a completed trip', async () => {
    const b = await booking();
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    // The owner marks the trip complete before the webhook lands. 'completed' is live everywhere else
    // in the ledger; treating it as dead here KEPT the capture and never applied it.
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'completed' where id = $1`, [b.id]);
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      req.paymentId,
      'completed-addon-evt',
      FAR_SEDAN_MINOR,
    ]);

    const after = (
      await db.pg.query<{ pickup_location: string | null; transport_minor: number }>(
        `select pickup_location, transport_minor from bookings where id = $1`,
        [b.id],
      )
    ).rows[0]!;
    expect(after.pickup_location).toBe('Le Morne Beach Villa');
    expect(after.transport_minor).toBe(FAR_SEDAN_MINOR);
  });

  it('flags a capture orphaned by a revision to a zero-fee address', async () => {
    const b = await booking();
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const first = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });

    // The guest pays, the webhook is lost, and later they revise to a free address.
    await db.asOwner();
    await db.pg.query(`update transport_band_pricing set sedan_minor = 0 where band = 'same'`);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const revised = await call<{ applied: boolean }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Grand Baie, Royal Palm',
      pickupLat: NORTH_LAT,
      pickupLng: NORTH_LNG,
    });
    expect(revised.applied).toBe(true);

    // The original session settles anyway. Nothing can apply it — but it must not vanish.
    await db.asOwner();
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      first.paymentId,
      'orphan-addon-evt',
      FAR_SEDAN_MINOR,
    ]);
    const alerts = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from notification_outbox
          where booking_id = $1 and template = 'owner_pickup_orphan_payment'`,
        [b.id],
      )
    ).rows[0]!.n;
    expect(Number(alerts)).toBe(1);
    await db.pg.query(`update transport_band_pricing set sedan_minor = 1500 where band = 'same'`);
  });

  it('does not raise an orphan alert on an ordinary replayed capture', async () => {
    const b = await booking();
    const addon = await addPaidPickup(b, 'noorphan');
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      addon,
      'noorphan-replay',
      FAR_SEDAN_MINOR,
    ]);
    const alerts = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from notification_outbox
          where booking_id = $1 and template = 'owner_pickup_orphan_payment'`,
        [b.id],
      )
    ).rows[0]!.n;
    expect(Number(alerts)).toBe(0);
  });

  it('keeps the invoice charge equal to what actually reached the booking total', async () => {
    const b = await booking();
    await db.asOwner();
    await db.pg.query(
      `update payments set charged_amount_minor = 371000, charged_currency = 'MUR' where id = $1`,
      [b.bookingPaymentId],
    );
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    await db.asOwner();
    await db.pg.query(
      `update payments set charged_amount_minor = 265000, charged_currency = 'MUR' where id = $1`,
      [req.paymentId],
    );
    // The guest cancels; the still-open session settles afterwards, so the fare never reaches the
    // total. Folding its charge into the receipt would print MUR 6,360 against a EUR 70 order — an
    // fx rate of 90 on a VAT document whose own lines add up to EUR 70.
    await db.pg.query(`update bookings set status = 'cancelled' where id = $1`, [b.id]);
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      req.paymentId,
      'receipt-orphan-evt',
      FAR_SEDAN_MINOR,
    ]);

    const receipt = await call<{
      payment: { chargedAmountMinor: number };
      totalEur: number;
    }>(db, 'api_booking_receipt', { bookingId: b.id });
    expect(receipt.totalEur).toBe(b.totalMinor / 100);
    expect(receipt.payment.chargedAmountMinor).toBe(371000);
  });

  it('still escalates to the owner when the guest cannot be chased at all', async () => {
    await db.asOwner();
    const act = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pickup_available, lat, lng)
         values ($1, 'no-pickup-owner-tour', 'activity', 'No Pickup Owner Tour', 'Sightseeing tours', 'published', false, $2, $3)
         returning id`,
        [operatorId, ACTIVITY_LAT, ACTIVITY_LNG],
      )
    ).rows[0]!.id;
    const opt = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Shared') returning id`,
        [act],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 7000)`,
      [opt],
    );
    const occ = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '10 days', now() + interval '10 days 4 hours', 10) returning id`,
        [opt, operatorId],
      )
    ).rows[0]!.id;
    const b = await booking(occ);
    await db.pg.query(
      `update session_occurrences set starts_at = now() + interval '20 hours',
              ends_at = now() + interval '24 hours' where id = $1`,
      [occ],
    );

    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_enqueue_pickup_reminders('{}'::jsonb)`);
    await db.asOwner();
    const rows = (
      await db.pg.query<{ template: string; payload: { guestChased?: boolean } }>(
        `select template, payload from notification_outbox
          where booking_id = $1 and idempotency_key like 'pickup%'`,
        [b.id],
      )
    ).rows;
    // The guest is NOT chased (the booking page would refuse them), but the owner still gets the one
    // signal that matters — and it says so, instead of claiming they were reminded twice.
    expect(rows.map((r) => r.template)).toEqual(['owner_pickup_missing']);
    expect(rows[0]!.payload.guestChased).toBe(false);
  });

  it('erases the guest address from queued notifications too', async () => {
    const b = await booking();
    await addPaidPickup(b, 'outbox-gdpr');
    await db.asOwner();
    await db.pg.query(`update bookings set user_id = $1 where id = $2`, [CUSTOMER, b.id]);
    const before = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from notification_outbox
          where booking_id = $1 and payload ? 'pickupLocation'`,
        [b.id],
      )
    ).rows[0]!.n;
    expect(Number(before)).toBeGreaterThan(0);

    await db.as({ sub: STAFF, role: 'authenticated' });
    await call(db, 'api_erase_user', { userId: CUSTOMER, email: `reg${seq}@example.com` });

    await db.asOwner();
    const left = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from notification_outbox
          where booking_id = $1
            and (payload ? 'pickupLocation' or payload ? 'customerPhone' or payload ? 'customerName')`,
        [b.id],
      )
    ).rows[0]!.n;
    // notify_pickup_set copied the street address and phone into the outbox payload, and nothing
    // purges that table — so redacting only customerName left the address behind forever.
    expect(Number(left)).toBe(0);
  });

  // ── Round 3: a refused supplement must not become a second charge ─────────────────────────────

  it('never re-sells a supplement it has already captured', async () => {
    await db.asOwner();
    const occ = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '10 days', now() + interval '10 days 4 hours', 10) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    const b = await booking(occ);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });

    // The departure is called off while the session is live, and the capture lands anyway: the
    // request stays OPEN behind a payments row that is already paid.
    await db.asOwner();
    await db.pg.query(`update session_occurrences set status = 'cancelled' where id = $1`, [occ]);
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      req.paymentId,
      'resell-addon-evt',
      FAR_SEDAN_MINOR,
    ]);

    // The guest is rescheduled onto a live date — the documented remedy — so the eligibility ladder
    // goes green again. The resume button must NOT mint a second Peach session on money we hold.
    await db.pg.query(`update session_occurrences set status = 'open' where id = $1`, [occ]);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      call(db, 'api_create_payment', {
        bookingRef: b.ref,
        idempotencyKey: 'resell-second-key',
        purpose: 'pickup_addon',
      }),
    ).rejects.toThrow(/pickup_already_paid/);
  });

  it('settles a supplement it already holds once the trip is running again', async () => {
    await db.asOwner();
    const occ = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '10 days', now() + interval '10 days 4 hours', 10) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    const b = await booking(occ);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    await db.asOwner();
    await db.pg.query(`update session_occurrences set status = 'cancelled' where id = $1`, [occ]);
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      req.paymentId,
      'refund-then-settle-evt',
      FAR_SEDAN_MINOR,
    ]);
    expect(
      (
        await db.pg.query<{ pickup_location: string | null }>(
          `select pickup_location from bookings where id = $1`,
          [b.id],
        )
      ).rows[0]!.pickup_location,
    ).toBeNull();

    // Rescheduled onto a live departure. The cron settles what we already hold, rather than leaving
    // the guest paid-and-unserved behind a button that would charge them again.
    await db.pg.query(`update session_occurrences set status = 'open' where id = $1`, [occ]);
    await db.as({ role: 'service_role' });
    // At least this one. Other cases in this file deliberately leave a funded-but-refused request
    // behind (their departure is still cancelled), and the sweep re-offers those every run — being
    // refused again each time, which is exactly the intended no-op.
    const applied = await db.pg.query<{ n: number }>(
      `select api_apply_funded_pickups('{}'::jsonb) as n`,
    );
    expect(applied.rows[0]!.n).toBeGreaterThanOrEqual(1);

    await db.asOwner();
    const after = (
      await db.pg.query<{ pickup_location: string | null; transport_minor: number }>(
        `select pickup_location, transport_minor from bookings where id = $1`,
        [b.id],
      )
    ).rows[0]!;
    expect(after.pickup_location).toBe('Le Morne Beach Villa');
    expect(after.transport_minor).toBe(FAR_SEDAN_MINOR);
  });

  it('tells the owner when one payment row takes more money than it asked for', async () => {
    const b = await booking();
    const addon = await addPaidPickup(b, 'overpay');
    // A second capture on the same row — the shape a duplicated checkout session produces. Every
    // branch of the reducer reads `>= amount_minor`, so without this alert it is indistinguishable
    // from the first and the apply trigger cannot fire again either.
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      addon,
      'overpay-second-capture',
      FAR_SEDAN_MINOR,
    ]);
    const alerts = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from notification_outbox
          where booking_id = $1 and template = 'owner_overpayment'`,
        [b.id],
      )
    ).rows[0]!.n;
    expect(Number(alerts)).toBe(1);
  });

  it('keeps the invoice honest after a zero-fee revision orphans the old charge', async () => {
    const b = await booking();
    await db.asOwner();
    await db.pg.query(
      `update payments set charged_amount_minor = 371000, charged_currency = 'MUR' where id = $1`,
      [b.bookingPaymentId],
    );
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const first = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    await db.asOwner();
    await db.pg.query(
      `update payments set charged_amount_minor = 265000, charged_currency = 'MUR' where id = $1`,
      [first.paymentId],
    );
    await db.pg.query(`update transport_band_pricing set sedan_minor = 0 where band = 'same'`);

    // Revised to a free address: the row is applied at zero and CUT LOOSE from that payment.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Grand Baie, Royal Palm',
      pickupLat: NORTH_LAT,
      pickupLng: NORTH_LNG,
    });
    await db.asOwner();
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      first.paymentId,
      'zero-revise-settle',
      FAR_SEDAN_MINOR,
    ]);

    const receipt = await call<{ payment: { chargedAmountMinor: number }; totalEur: number }>(
      db,
      'api_booking_receipt',
      { bookingId: b.id },
    );
    // Nothing of that payment reached total_minor, so nothing of it may reach the charged figure.
    expect(receipt.totalEur).toBe(b.totalMinor / 100);
    expect(receipt.payment.chargedAmountMinor).toBe(371000);
    await db.pg.query(`update transport_band_pricing set sedan_minor = 1500 where band = 'same'`);
  });

  it('keeps the invoice whole after the guest is erased', async () => {
    const b = await booking();
    await db.asOwner();
    await db.pg.query(
      `update payments set charged_amount_minor = 371000, charged_currency = 'MUR' where id = $1`,
      [b.bookingPaymentId],
    );
    const addon = await addPaidPickup(b, 'erase-invoice');
    await db.pg.query(
      `update payments set charged_amount_minor = 265000, charged_currency = 'MUR' where id = $1`,
      [addon],
    );
    const before = await call<{ payment: { chargedAmountMinor: number } }>(
      db,
      'api_booking_receipt',
      {
        bookingId: b.id,
      },
    );
    expect(before.payment.chargedAmountMinor).toBe(636000);

    await db.pg.query(`update bookings set user_id = $1 where id = $2`, [CUSTOMER, b.id]);
    await db.as({ sub: STAFF, role: 'authenticated' });
    await call(db, 'api_erase_user', { userId: CUSTOMER, email: `reg${seq}@example.com` });

    await db.asOwner();
    const after = await call<{ payment: { chargedAmountMinor: number }; totalEur: number }>(
      db,
      'api_booking_receipt',
      { bookingId: b.id },
    );
    // Erasure must not rewrite the money on the record it exists to RETAIN.
    expect(after.payment.chargedAmountMinor).toBe(636000);
    expect(after.totalEur).toBe((b.totalMinor + FAR_SEDAN_MINOR) / 100);
  });

  it('re-queries a supplement whose session was minted long after the address', async () => {
    const b = await booking();
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ paymentId: string }>(db, 'api_request_pickup', {
      bookingRef: b.ref,
      pickupLocation: 'Le Morne Beach Villa',
      pickupLat: SOUTH_LAT,
      pickupLng: SOUTH_LNG,
    });
    // The guest commits the address, walks away, and pays from the resume button six hours later.
    // The grace window has to cover the SESSION, not the intent, or a lost webhook is never swept.
    await db.asOwner();
    await db.pg.query(
      `update payments
          set created_at = now() - interval '6 hours',
              provider_checkout_id = 'chk_late_mint', checkout_created_at = now()
        where id = $1`,
      [req.paymentId],
    );
    const found = await call<Array<{ paymentId: string }>>(db, 'api_pending_payment_checkouts', {});
    expect(found.some((c) => c.paymentId === req.paymentId)).toBe(true);
  });
});
