import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';

/**
 * append_payment_event maintains balance_due_minor (Task 3 of the quote-deposit plan).
 *
 * The deposit is the first `booking` payments row SIZED to the deposit, so the UNCHANGED confirm-on-
 * paid path confirms the booking when the deposit clears. "How much is still owed" lives in
 * bookings.balance_due_minor, kept OUT of the payment_state roll-up so the enum (and its sticky-failed
 * protection) is untouched. This file pins the one thing append_payment_event gains: after crediting a
 * row it recomputes balance_due_minor as total_minor minus everything settled against the order, summed
 * over the `booking` (deposit) and `balance` rows — a projection over ROWS, never latched from the one
 * row the event touched.
 *
 *   1. Deposit settles  -> booking confirmed, payment_state 'paid' (roll-up unchanged), balance still owed.
 *   2. Balance settles   -> balance_due_minor reaches 0. Booking stays confirmed (status no-op).
 *   3. Balance DECLINED  -> balance_due_minor unchanged, and the failed balance row does NOT drag the
 *      already-paid booking backwards (the roll-up ranks paid over failed).
 */

interface CreatePaymentOut {
  paymentId: string;
  amountMinor: number;
}

interface BookingState {
  status: string;
  payment_state: string;
  balance_due_minor: number;
}

describe('append_payment_event maintains balance_due_minor', () => {
  let db: TestDb;
  let seq = 0;

  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  /** A sent quote with one custom line summing to `totalMinor`, converted through the real RPC. */
  async function convertQuote(totalMinor: number, depositBps: number): Promise<{ ref: string }> {
    seq += 1;
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, status, valid_until, total_minor, deposit_bps, sent_at)
       values ($1, 'Marie Dupont', $2, 'sent', current_date + 7, $3, $4, now()) returning id`,
      [`QLED${seq}`, `led${seq}@example.com`, totalMinor, depositBps],
    );
    const quoteId = rows[0]!.id;
    await db.pg.query(
      `insert into quote_items (quote_id, position, kind, description, starts_at, quantity,
                                unit_amount_minor, subtotal_minor)
       values ($1, 1, 'custom', 'Private guide, full day', now() + interval '10 days', 1, $2, $2)`,
      [quoteId, totalMinor],
    );
    await db.as({ role: 'service_role' });
    const booking = await call<{ ref: string }>('api_convert_quote', { quoteId });
    return { ref: booking.ref };
  }

  /** The deposit `booking` row, minted the way the quote guest's pay route does. */
  async function mintDeposit(ref: string, key: string): Promise<CreatePaymentOut> {
    await db.as({ role: 'service_role' });
    return call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: key,
    });
  }

  /**
   * The balance row. Task 4 mints this through create_payment's 'balance' branch; Task 3 only needs
   * append_payment_event to keep balance_due_minor once a 'balance' row settles, so insert one directly.
   */
  async function mintBalanceRow(ref: string, amountMinor: number): Promise<string> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor, purpose)
       select b.id, $2, $3, 'balance' from bookings b where b.ref = $1 returning id`,
      [ref, `${ref}-bal`, amountMinor],
    );
    return rows[0]!.id;
  }

  async function settle(
    paymentId: string,
    type: 'paid' | 'failed',
    eventId: string,
    amountMinor: number,
  ): Promise<void> {
    await db.as({ role: 'service_role' });
    await db.pg.query(
      `select append_payment_event($1::uuid, $2::text, $3::text, $4::bigint, now(), '{}'::jsonb)`,
      [paymentId, type, eventId, amountMinor],
    );
  }

  async function bookingState(ref: string): Promise<BookingState> {
    await db.asOwner();
    const { rows } = await db.pg.query<BookingState>(
      `select status::text as status, payment_state::text as payment_state, balance_due_minor
         from bookings where ref = $1`,
      [ref],
    );
    return { ...rows[0]!, balance_due_minor: Number(rows[0]!.balance_due_minor) };
  }

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('the deposit settling confirms + pays the booking but leaves the 90% balance owed', async () => {
    const { ref } = await convertQuote(100000, 1000); // EUR 1000, 10% deposit
    const dep = await mintDeposit(ref, 'led-dep1');
    expect(dep.amountMinor).toBe(10000); // the deposit, not the full total

    await settle(dep.paymentId, 'paid', 'evt-dep1', 10000);

    const after = await bookingState(ref);
    expect(after.status).toBe('confirmed'); // the deposit confirms the booking, unchanged path
    expect(after.payment_state).toBe('paid'); // roll-up over the single 'booking' row
    expect(after.balance_due_minor).toBe(90000); // the balance is STILL owed — NOT zeroed on the deposit
  });

  it('the balance settling clears balance_due_minor to 0', async () => {
    const { ref } = await convertQuote(100000, 1000);
    const dep = await mintDeposit(ref, 'led-dep2');
    await settle(dep.paymentId, 'paid', 'evt-dep2', 10000);
    expect((await bookingState(ref)).balance_due_minor).toBe(90000);

    const balId = await mintBalanceRow(ref, 90000);
    await settle(balId, 'paid', 'evt-bal2', 90000);

    const after = await bookingState(ref);
    expect(after.balance_due_minor).toBe(0); // deposit + balance now cover the full total
    expect(after.status).toBe('confirmed'); // settling the balance is a status no-op
    expect(after.payment_state).toBe('paid'); // both rows paid -> roll-up 'paid'
  });

  it('a DECLINED balance leaves the balance owed and does not drag the paid booking backwards', async () => {
    const { ref } = await convertQuote(100000, 1000);
    const dep = await mintDeposit(ref, 'led-dep3');
    await settle(dep.paymentId, 'paid', 'evt-dep3', 10000);

    const balId = await mintBalanceRow(ref, 90000);
    await settle(balId, 'failed', 'evt-bal-fail', 0); // a decline pays nothing off

    const after = await bookingState(ref);
    expect(after.balance_due_minor).toBe(90000); // still owed — a failed row settles nothing
    expect(after.status).toBe('confirmed'); // roll-up protection: the paid deposit still holds it
    expect(after.payment_state).toBe('paid'); // 'paid' outranks 'failed' across the two rows
  });

  it('an ORPHANED pickup capture whose fee never reached total_minor does NOT reduce the balance owed', async () => {
    // The under-collection the all-rows sum caused. A 30%-deposit booking: total 10000, deposit 3000
    // paid, balance 7000 still owed. The guest requested a chargeable far pickup, then revised to a free
    // zone — api_request_pickup applies that revision at fee 0 and CUTS the old payment_id LOOSE
    // (20260910000000:376-380) — and only afterwards the old fee>0 Peach session settles. That capture
    // lands with no unapplied request to attach to, so apply_pickup_request takes its ORPHAN branch
    // (notify_pickup_orphan_payment, :623) and total_minor is NEVER grown. Modelled here by settling a
    // 'pickup_addon' row that has no matching booking_pickup_requests row, so the real trigger runs the
    // real orphan path. balance_due_minor must still read the true 7000: summing the orphan's GROSS
    // paid_minor reported 2000 (10000 - 3000 - 5000), under-collecting the balance by the whole fee —
    // and, because the sum is gross, it stayed wrong even after the owner refunded the orphaned capture.
    const { ref } = await convertQuote(10000, 3000); // total EUR 100, 30% deposit
    const dep = await mintDeposit(ref, 'led-orphan-dep');
    expect(dep.amountMinor).toBe(3000); // the deposit, sized to 30%
    await settle(dep.paymentId, 'paid', 'evt-orphan-dep', 3000);
    expect(await bookingState(ref)).toMatchObject({ status: 'confirmed', balance_due_minor: 7000 });

    // The old, higher-fee pickup session settles after the free-zone revision cut its request loose: a
    // 'pickup_addon' capture with no unapplied request behind it. apply_pickup_request finds nothing to
    // apply and orphans it; total_minor stays 10000.
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor, purpose)
       select b.id, $2, 5000, 'pickup_addon' from bookings b where b.ref = $1 returning id`,
      [ref, `${ref}-orphan-pickup`],
    );
    const orphanId = rows[0]!.id;
    await settle(orphanId, 'paid', 'evt-orphan-pickup', 5000);

    await db.asOwner();
    const { rows: tot } = await db.pg.query<{ total_minor: number }>(
      `select total_minor from bookings where ref = $1`,
      [ref],
    );
    expect(Number(tot[0]!.total_minor)).toBe(10000); // the orphaned fee never reached the order total
    expect((await bookingState(ref)).balance_due_minor).toBe(7000); // …so the balance owed is unchanged
  });

  it('a deposit+balance fully-paid quote booking that then pays an APPLIED pickup add-on owes nothing', async () => {
    // GOAL 3b: the deposit-path analogue of the customer add-on case. Bring a quote booking to
    // fully-paid via BOTH the deposit and the balance rows, then add + settle a late-pickup supplement
    // whose request APPLIES. apply_pickup_request grows total_minor by the fee from inside
    // append_payment_event's own status write, and the applied pickup's capture counts on the summed
    // side — so the fee appears on both sides and nets to 0. This proves the projection is not specific
    // to the single-`booking`-row customer path: it holds when the total was covered by deposit + balance
    // too. (It passes against the CURRENT formula, which already scopes the sum to booking/balance rows
    // OR an applied pickup — the point is to lock that in so a later re-definition cannot regress it.)
    const { ref } = await convertQuote(100000, 1000); // EUR 1000, 10% deposit
    const dep = await mintDeposit(ref, 'led-3b-dep');
    await settle(dep.paymentId, 'paid', 'evt-3b-dep', 10000);
    const balId = await mintBalanceRow(ref, 90000);
    await settle(balId, 'paid', 'evt-3b-bal', 90000);
    expect((await bookingState(ref)).balance_due_minor).toBe(0); // deposit + balance cover the full total

    // A 'pickup_addon' payments row behind an OPEN request pointing at it. Settling it fires the real
    // apply_pickup_request trigger, which grows total_minor by the fee and stamps applied_at — so the
    // applied pickup counts on BOTH sides of the projection.
    const PICKUP_FEE = 5000;
    await db.asOwner();
    const { rows: pick } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor, purpose)
       select b.id, $2, $3, 'pickup_addon' from bookings b where b.ref = $1 returning id`,
      [ref, `${ref}-3b-pickup`, PICKUP_FEE],
    );
    const pickupId = pick[0]!.id;
    await db.pg.query(
      `insert into booking_pickup_requests (booking_id, payment_id, pickup_location, pickup_lat, pickup_lng, fee_minor)
       select b.id, $2, 'Le Morne Villa', -20.5, 57.3, $3 from bookings b where b.ref = $1`,
      [ref, pickupId, PICKUP_FEE],
    );
    await settle(pickupId, 'paid', 'evt-3b-pickup', PICKUP_FEE);

    await db.asOwner();
    const { rows: tot } = await db.pg.query<{ total_minor: number; balance_due_minor: number }>(
      `select total_minor, balance_due_minor from bookings where ref = $1`,
      [ref],
    );
    expect(Number(tot[0]!.total_minor)).toBe(100000 + PICKUP_FEE); // apply_pickup_request grew the order total
    expect(Number(tot[0]!.balance_due_minor)).toBe(0); // …and the applied pickup nets out — nothing owed
  });
});

/**
 * balance_due_minor must stay consistent with total_minor across ALL of a booking's payment rows —
 * not just the deposit/balance pair. The late-pickup add-on is the case that proves it: settling a
 * 'pickup_addon' row fires apply_pickup_request (an AFTER-UPDATE-of-status trigger on payments) from
 * INSIDE append_payment_event's own `update payments set status=…`, and that trigger GROWS
 * total_minor by the fee BEFORE the balance_due_minor statement runs in the same call. If the summed
 * side excluded the add-on row, a fully-paid customer who then pays a pickup supplement would be left
 * owing the fee (total_minor grew, the sum did not) — a phantom balance on money that is fully paid.
 * So the projection sums paid_minor over EVERY row: the add-on adds +fee to both sides and nets to 0.
 */
describe('append_payment_event keeps balance_due_minor consistent with a grown total_minor', () => {
  let db: TestDb;
  let occurrenceId: string;
  let operatorId: string;
  let optionId: string;

  const CUSTOMER = 'c0ffee00-0000-4000-8000-0000000000a1';
  /** North: the activity boards here. */
  const ACTIVITY_LAT = -20.0;
  const ACTIVITY_LNG = 57.6;
  /** South: North↔South is seeded 'far' → sedan €50 for a party of 1–4. */
  const SOUTH_LAT = -20.5;
  const SOUTH_LNG = 57.5;
  const ADULT_MINOR = 7000;
  const FAR_SEDAN_MINOR = 5000;

  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  async function balanceDue(bookingId: string): Promise<number> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ balance_due_minor: number }>(
      `select balance_due_minor from bookings where id = $1`,
      [bookingId],
    );
    return Number(rows[0]!.balance_due_minor);
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    operatorId = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Balance Pickup Tours', 'balance-pickup-tours') returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);

    const activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pickup_available, lat, lng)
         values ($1, 'balance-pickup-tour', 'activity', 'Balance Pickup Tour', 'Sightseeing tours', 'published', true, $2, $3)
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
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', $2)`,
      [optionId, ADULT_MINOR],
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

  it('a fully-paid customer booking that then pays a late-pickup add-on owes nothing', async () => {
    // A confirmed + paid ORDINARY customer booking (no deposit) whose pickup is still to arrange.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      party: { Adult: 1 },
      pickupPending: true,
      customerName: 'Add-on Balance Tester',
      customerEmail: 'addon-balance@example.com',
      source: 'web',
      idempotencyKey: 'addon-balance-idem-0001',
    });

    await db.asOwner();
    const { rows: b } = await db.pg.query<{ id: string; total_minor: number }>(
      `select id, total_minor from bookings where ref = $1`,
      [booked.ref],
    );
    const bookingId = b[0]!.id;
    const totalBefore = Number(b[0]!.total_minor);
    expect(totalBefore).toBe(ADULT_MINOR);

    // Pay the booking in full through the ledger, exactly as the webhook does.
    const { rows: pay } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor, status, purpose)
       values ($1, 'addon-balance-pay', $2, 'pending', 'booking') returning id`,
      [bookingId, totalBefore],
    );
    await db.pg.query(
      `select append_payment_event($1, 'paid', 'addon-balance-evt', $2, now(), '{}'::jsonb)`,
      [pay[0]!.id, totalBefore],
    );
    // Baseline: a fully-paid customer booking owes nothing (default 0 recomputes to 0).
    expect(await balanceDue(bookingId)).toBe(0);

    // The guest adds a late pickup and pays the region supplement as a SECOND payments row.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const req = await call<{ applied: boolean; feeMinor: number; paymentId: string }>(
      'api_request_pickup',
      {
        bookingRef: booked.ref,
        pickupLocation: 'Le Morne Beach Villa',
        pickupLat: SOUTH_LAT,
        pickupLng: SOUTH_LNG,
      },
    );
    expect(req.applied).toBe(false);
    expect(req.feeMinor).toBe(FAR_SEDAN_MINOR);

    // Settling the add-on GROWS total_minor by the fee (apply_pickup_request) from inside
    // append_payment_event, before it recomputes balance_due_minor. The fee is fully paid.
    await db.asOwner();
    await db.pg.query(
      `select append_payment_event($1, 'paid', 'addon-balance-addon-evt', $2, now(), '{}'::jsonb)`,
      [req.paymentId, FAR_SEDAN_MINOR],
    );

    const { rows: after } = await db.pg.query<{ total_minor: number; balance_due_minor: number }>(
      `select total_minor, balance_due_minor from bookings where id = $1`,
      [bookingId],
    );
    expect(Number(after[0]!.total_minor)).toBe(totalBefore + FAR_SEDAN_MINOR); // total grew with the fee
    expect(Number(after[0]!.balance_due_minor)).toBe(0); // …and the fully-paid guest owes nothing
  });
});
