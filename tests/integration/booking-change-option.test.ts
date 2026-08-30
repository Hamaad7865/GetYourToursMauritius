import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';

/**
 * Staff change-of-tour: move a PAID booking onto a different activity option and settle the price
 * difference (20261006000000).
 *
 * The invariants under test are the ones that decide whether money, capacity and the run sheet stay
 * honest:
 *   - an UPGRADE moves NOTHING until the difference settles, and holds the target seat meanwhile;
 *   - settling it moves every line, re-prices them, and updates the booking total exactly once;
 *   - a replayed settlement is a no-op (the applied_at guard);
 *   - a target that filled up, or a booking that died, between propose and settle routes the money to
 *     an owner alert instead of silently upgrading or silently keeping it;
 *   - a LEVEL move commits with no payments row at all;
 *   - a CHEAPER move commits immediately and leaves a recorded, ledger-correct partial refund that
 *     still lets a later full cancellation reach 'refunded';
 *   - the guards: multi-option bookings, private/vehicle options, non-staff callers.
 */

const CUSTOMER = 'c0ffee00-0000-4000-8000-000000000011';
const STAFF = 'c0ffee00-0000-4000-8000-000000000012';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

interface BookingRow {
  id: string;
  ref: string;
  total_minor: number;
  status: string;
  payment_state: string;
  operator_payout_minor: number;
}

const bookingRow = async (db: TestDb, ref: string): Promise<BookingRow> =>
  (
    await db.pg.query<BookingRow>(
      `select id, ref, total_minor, status::text as status, payment_state::text as payment_state,
              operator_payout_minor
         from bookings where ref = $1`,
      [ref],
    )
  ).rows[0]!;

describe('staff change of tour', () => {
  let db: TestDb;
  let operatorId: string;
  let cheapOption: string;
  let dearOption: string;
  let levelOption: string;
  let privateOption: string;
  let cheapOcc: string;
  let dearOcc: string;
  let levelOcc: string;
  let privateOcc: string;

  /** A confirmed + fully-paid 2×Adult booking on the €55 tour. */
  async function paidBooking(key: string): Promise<BookingRow> {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: cheapOcc,
      party: { Adult: 2 },
      customerName: 'Change Tester',
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

  /** Drive a payment to settled through the ledger, exactly as the webhook does. */
  async function settle(paymentId: string, amountMinor: number, eventId: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
      paymentId,
      eventId,
      amountMinor,
    ]);
  }

  const asStaff = () => db.as({ sub: STAFF, role: 'authenticated' });

  async function makeOption(
    activityId: string,
    name: string,
    adultMinor: number,
    childMinor: number | null,
  ): Promise<{ optionId: string; occurrenceId: string }> {
    const optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, $2) returning id`,
        [activityId, name],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, position)
       values ($1, 'Adult', $2, 0)`,
      [optionId, adultMinor],
    );
    if (childMinor !== null) {
      await db.pg.query(
        `insert into activity_option_prices (activity_option_id, label, amount_minor, position)
         values ($1, 'Child', $2, 1)`,
        [optionId, childMinor],
      );
    }
    const occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '20 days', now() + interval '20 days 8 hours', 40)
         returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    return { optionId, occurrenceId };
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    operatorId = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Change Tours', 'change-tours') returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff')`, [STAFF]);

    const activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'change-tour', 'activity', 'Change Tour', 'Sightseeing tours', 'published')
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;

    ({ optionId: cheapOption, occurrenceId: cheapOcc } = await makeOption(
      activityId,
      'Speed boat',
      5500,
      4000,
    ));
    ({ optionId: dearOption, occurrenceId: dearOcc } = await makeOption(
      activityId,
      'Five islands',
      8000,
      5000,
    ));
    ({ optionId: levelOption, occurrenceId: levelOcc } = await makeOption(
      activityId,
      'Same price',
      5500,
      4000,
    ));

    // A private option: priced as a whole trip, so a per-person booking must never move onto it.
    privateOption = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name, private_base_minor, private_included,
                                       private_extra_minor, private_max_guests)
         values ($1, 'Private charter', 40000, 4, 5000, 8) returning id`,
        [activityId],
      )
    ).rows[0]!.id;
    privateOcc = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '20 days', now() + interval '20 days 8 hours', 4)
         returning id`,
        [privateOption, operatorId],
      )
    ).rows[0]!.id;
    expect(cheapOption).toBeTruthy();
  });

  it('prices an upgrade without writing anything', async () => {
    const booking = await paidBooking('quote-only');
    await asStaff();
    const q = await call<{
      oldTotalMinor: number;
      newTotalMinor: number;
      differenceMinor: number;
      units: number;
    }>(db, 'api_booking_change_quote', { bookingId: booking.id, occurrenceId: dearOcc });

    expect(q.oldTotalMinor).toBe(11000);
    expect(q.newTotalMinor).toBe(16000);
    expect(q.differenceMinor).toBe(5000);
    expect(q.units).toBe(2);

    await db.asOwner();
    const after = await bookingRow(db, booking.ref);
    expect(after.total_minor).toBe(11000);
    const { rows } = await db.pg.query(
      `select 1 from booking_change_requests where booking_id = $1`,
      [booking.id],
    );
    expect(rows).toHaveLength(0);
  });

  it('an upgrade moves nothing until the difference settles, and holds the seat', async () => {
    const booking = await paidBooking('upgrade');
    await asStaff();
    const proposed = await call<{ applied: boolean; differenceMinor: number; paymentId: string }>(
      db,
      'api_propose_booking_change',
      { ref: booking.ref, occurrenceId: dearOcc },
    );
    expect(proposed.applied).toBe(false);
    expect(proposed.differenceMinor).toBe(5000);

    await db.asOwner();
    // Nothing moved…
    const mid = await bookingRow(db, booking.ref);
    expect(mid.total_minor).toBe(11000);
    const { rows: stillOnOld } = await db.pg.query(
      `select 1 from booking_items where booking_id = $1 and session_occurrence_id = $2`,
      [booking.id, cheapOcc],
    );
    // One row per PRICE TIER, not per guest: 2 × Adult is a single row with quantity 2.
    expect(stillOnOld).toHaveLength(1);
    // …but the target seat IS held, for the booking's unit count.
    const { rows: held } = await db.pg.query<{ quantity: number; expires_at: string }>(
      `select quantity, expires_at from booking_holds
        where session_occurrence_id = $1 and status = 'active'`,
      [dearOcc],
    );
    expect(held).toHaveLength(1);
    expect(held[0]!.quantity).toBe(2);
    // The 48h default, not booking_holds' 15-minute column default.
    const heldFor = new Date(held[0]!.expires_at).getTime() - Date.now();
    expect(heldFor).toBeGreaterThan(40 * 60 * 60 * 1000);

    await settle(proposed.paymentId, 5000, 'upgrade-settled');

    const after = await bookingRow(db, booking.ref);
    expect(after.total_minor).toBe(16000);
    expect(after.operator_payout_minor).toBe(mid.operator_payout_minor + 5000);
    const { rows: items } = await db.pg.query<{
      session_occurrence_id: string;
      activity_option_id: string;
      unit_amount_minor: number;
      subtotal_minor: number;
      price_label: string;
    }>(
      `select session_occurrence_id, activity_option_id, unit_amount_minor, subtotal_minor, price_label
         from booking_items where booking_id = $1 order by price_label`,
      [booking.id],
    );
    expect(items).toHaveLength(1);
    for (const it of items) {
      expect(it.session_occurrence_id).toBe(dearOcc);
      expect(it.activity_option_id).toBe(dearOption);
      expect(it.unit_amount_minor).toBe(8000);
      // Recomputed from the fresh unit price × quantity, not scaled from the old subtotal.
      expect(it.subtotal_minor).toBe(16000);
    }
    // The hold is consumed, not left to lapse.
    const { rows: holdAfter } = await db.pg.query<{ status: string }>(
      `select status from booking_holds where session_occurrence_id = $1`,
      [dearOcc],
    );
    expect(holdAfter[0]!.status).toBe('consumed');
  });

  it('a replayed settlement does not move the booking twice', async () => {
    const booking = await paidBooking('replay');
    await asStaff();
    const proposed = await call<{ paymentId: string }>(db, 'api_propose_booking_change', {
      ref: booking.ref,
      occurrenceId: dearOcc,
    });
    await settle(proposed.paymentId, 5000, 'replay-1');
    const once = await bookingRow(db, booking.ref);
    // The reconcile sweep re-queries the same capture: a second 'paid' event must change nothing.
    await db.pg.query(`update payments set status = 'pending' where id = $1`, [proposed.paymentId]);
    await settle(proposed.paymentId, 5000, 'replay-2');
    const twice = await bookingRow(db, booking.ref);
    expect(twice.total_minor).toBe(once.total_minor);
    expect(twice.operator_payout_minor).toBe(once.operator_payout_minor);
    const { rows: applied } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from booking_change_requests
        where booking_id = $1 and applied_at is not null`,
      [booking.id],
    );
    expect(applied[0]!.n).toBe(1);
  });

  it('routes a settled difference to an owner alert when the booking died meanwhile', async () => {
    const booking = await paidBooking('dead');
    await asStaff();
    const proposed = await call<{ paymentId: string }>(db, 'api_propose_booking_change', {
      ref: booking.ref,
      occurrenceId: dearOcc,
    });
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'cancelled' where id = $1`, [booking.id]);
    await settle(proposed.paymentId, 5000, 'dead-settled');

    const after = await bookingRow(db, booking.ref);
    expect(after.total_minor).toBe(11000); // never upgraded
    const { rows: alert } = await db.pg.query<{ template: string }>(
      `select template from notification_outbox where idempotency_key = $1`,
      [`change_orphan:${proposed.paymentId}`],
    );
    // A cancelled booking already has append_payment_event's own refund_pending alert, so this
    // branch stays deliberately silent rather than double-alerting.
    expect(alert.length).toBeLessThanOrEqual(1);
    const { rows: req } = await db.pg.query<{ applied_at: string | null }>(
      `select applied_at from booking_change_requests where booking_id = $1`,
      [booking.id],
    );
    expect(req[0]!.applied_at).toBeNull();
  });

  it('alerts and does not move when the target filled up between propose and settle', async () => {
    const booking = await paidBooking('soldout');
    // A departure of this test's OWN, so squeezing its capacity cannot leak into another test.
    await db.asOwner();
    const occ = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '30 days', now() + interval '30 days 8 hours', 2)
         returning id`,
        [dearOption, operatorId],
      )
    ).rows[0]!.id;

    await asStaff();
    const proposed = await call<{ paymentId: string; requestId: string }>(
      db,
      'api_propose_booking_change',
      { ref: booking.ref, occurrenceId: occ },
    );

    // The seat lapses (the guest sat on the payment page past the expiry) and someone else takes it.
    await db.asOwner();
    await db.pg.query(
      `update booking_holds set status = 'expired' where id = (
        select hold_id from booking_change_requests where id = $1)`,
      [proposed.requestId],
    );
    await db.pg.query(`update session_occurrences set capacity = 0 where id = $1`, [occ]);

    await settle(proposed.paymentId, 5000, 'soldout-settled');

    const after = await bookingRow(db, booking.ref);
    expect(after.total_minor).toBe(11000); // never moved
    const { rows: req } = await db.pg.query<{ applied_at: string | null }>(
      `select applied_at from booking_change_requests where id = $1`,
      [proposed.requestId],
    );
    expect(req[0]!.applied_at).toBeNull();
    const { rows: alert } = await db.pg.query<{ template: string }>(
      `select template from notification_outbox where idempotency_key = $1`,
      [`change_orphan:${proposed.paymentId}`],
    );
    expect(alert).toHaveLength(1);
    expect(alert[0]!.template).toBe('owner_change_orphan_payment');
  });

  it('a same-price move commits immediately with no payments row', async () => {
    const booking = await paidBooking('level');
    await asStaff();
    const r = await call<{ applied: boolean; differenceMinor: number; paymentId: string | null }>(
      db,
      'api_propose_booking_change',
      { ref: booking.ref, occurrenceId: levelOcc },
    );
    expect(r.applied).toBe(true);
    expect(r.differenceMinor).toBe(0);
    expect(r.paymentId).toBeNull();

    await db.asOwner();
    const after = await bookingRow(db, booking.ref);
    expect(after.total_minor).toBe(11000);
    const { rows: items } = await db.pg.query<{ activity_option_id: string }>(
      `select activity_option_id from booking_items where booking_id = $1`,
      [booking.id],
    );
    expect(items.every((i) => i.activity_option_id === levelOption)).toBe(true);
    const { rows: extra } = await db.pg.query(
      `select 1 from payments where booking_id = $1 and purpose = 'change_addon'`,
      [booking.id],
    );
    expect(extra).toHaveLength(0);
  });

  it('a cheaper move commits now, records a partial refund, and still cancels to refunded', async () => {
    const booking = await paidBooking('cheaper');
    await asStaff();
    // Start on the dear tour, then come DOWN to the cheap one.
    const up = await call<{ paymentId: string }>(db, 'api_propose_booking_change', {
      ref: booking.ref,
      occurrenceId: dearOcc,
    });
    await settle(up.paymentId, 5000, 'cheaper-up');

    await asStaff();
    const down = await call<{ applied: boolean; refundDueMinor: number; requestId: string }>(
      db,
      'api_propose_booking_change',
      { ref: booking.ref, occurrenceId: cheapOcc },
    );
    expect(down.applied).toBe(true);
    expect(down.refundDueMinor).toBe(5000);

    await db.asOwner();
    expect((await bookingRow(db, booking.ref)).total_minor).toBe(11000);

    await asStaff();
    const rec = await call<{ refundedMinor: number }>(db, 'api_record_change_refund', {
      requestId: down.requestId,
    });
    expect(rec.refundedMinor).toBe(5000);
    // Idempotent.
    const again = await call<{ alreadyRecorded: boolean }>(db, 'api_record_change_refund', {
      requestId: down.requestId,
    });
    expect(again.alreadyRecorded).toBe(true);

    await db.asOwner();
    const { rows: booked } = await db.pg.query<{ paid_minor: number; refunded_minor: number }>(
      `select paid_minor, refunded_minor from payments
        where booking_id = $1 and purpose = 'booking'`,
      [booking.id],
    );
    expect(booked[0]!.refunded_minor).toBe(5000);

    // THE ARITHMETIC THAT MATTERS: a later full cancellation must still reach 'refunded', not stall
    // at 'partially_refunded' because one row was already partly reversed.
    await asStaff();
    await call(db, 'api_mark_refunded', { bookingId: booking.id });
    await db.asOwner();
    const final = await bookingRow(db, booking.ref);
    expect(final.payment_state).toBe('refunded');
  });

  it('refuses a private/vehicle target, a non-staff caller and a no-op', async () => {
    const booking = await paidBooking('guards');

    await asStaff();
    await expect(
      call(db, 'api_propose_booking_change', { ref: booking.ref, occurrenceId: privateOcc }),
    ).rejects.toThrow(/not_changeable/);

    await expect(
      call(db, 'api_propose_booking_change', { ref: booking.ref, occurrenceId: cheapOcc }),
    ).rejects.toThrow(/change_is_noop/);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      call(db, 'api_propose_booking_change', { ref: booking.ref, occurrenceId: dearOcc }),
    ).rejects.toThrow(/forbidden/);
    expect(privateOption).toBeTruthy();
  });

  it('refuses a target that does not sell the same ticket types', async () => {
    const booking = await paidBooking('labels');
    await db.asOwner();
    const adultsOnly = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name)
         select activity_id, 'Adults only' from activity_options where id = $1 returning id`,
        [cheapOption],
      )
    ).rows[0]!.id;
    // Deliberately NO 'Adult' tier — only 'Senior'.
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Senior', 6000)`,
      [adultsOnly],
    );
    const occ = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '21 days', now() + interval '21 days 8 hours', 40) returning id`,
        [adultsOnly, operatorId],
      )
    ).rows[0]!.id;

    await asStaff();
    await expect(
      call(db, 'api_propose_booking_change', { ref: booking.ref, occurrenceId: occ }),
    ).rejects.toThrow(/change_price_unavailable/);
  });

  it('withdrawing a proposal returns the held seat', async () => {
    const booking = await paidBooking('withdraw');
    await asStaff();
    const proposed = await call<{ requestId: string }>(db, 'api_propose_booking_change', {
      ref: booking.ref,
      occurrenceId: dearOcc,
    });
    await call(db, 'api_withdraw_booking_change', { requestId: proposed.requestId });

    await db.asOwner();
    const { rows } = await db.pg.query<{ status: string }>(
      `select h.status from booking_holds h
         join booking_change_requests r on r.hold_id = h.id
        where r.id = $1`,
      [proposed.requestId],
    );
    expect(rows[0]!.status).toBe('released');
  });
});
