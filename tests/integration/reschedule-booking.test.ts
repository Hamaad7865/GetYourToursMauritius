import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';

/**
 * Weather disruption + rescheduling.
 *
 * api_reschedule_booking moves every item of a confirmed+paid booking onto another occurrence OF THE
 * SAME OPTION — same option means same price, so the payment ledger is never touched. It re-checks
 * capacity under FOR UPDATE, refuses a cross-option target, and closes 24h before the trip.
 *
 * api_weather_cancel_occurrence is the staff fan-out: cancel one blown-out departure and every guest
 * on it is stamped with `disruption` and mailed the choice. That stamp is also what BYPASSES the 24h
 * window in both this RPC and api_cancel_booking — a guest whose Tuesday trip we killed on Monday
 * must still be able to move or refund.
 */
const CUSTOMER = 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9';
const OTHER = 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1';
const STAFF = 'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('api_reschedule_booking / api_weather_cancel_occurrence', () => {
  let db: TestDb;
  let operatorId: string;
  let optId: string;
  let otherOptId: string;

  async function makeOccurrence(interval: string, capacity = 5, option?: string): Promise<string> {
    await db.asOwner(); // occurrences are owner-managed (RLS); reset the role after a prior test left it
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
       values ($1, $2, now() + interval '${interval}', now() + interval '${interval}' + interval '2 hours', $3)
       returning id`,
      [option ?? optId, operatorId, capacity],
    );
    return rows[0]!.id;
  }

  /** Book 2 adults as the customer, pay, and confirm via the verified webhook path. Returns the ref. */
  async function bookConfirm(occurrenceId: string, idem: string): Promise<string> {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      party: { Adult: 2 },
      customerName: 'Jean Dupont',
      customerEmail: 'jean@example.com',
      source: 'web',
      idempotencyKey: `book-${idem}`,
    });
    const payment = await call<{ paymentId: string; amountMinor: number }>(
      db,
      'api_create_payment',
      { bookingRef: booking.ref, idempotencyKey: `pay-${idem}` },
    );
    await db.as({ sub: 'service', role: 'service_role' });
    await call(db, 'api_record_payment_charge', {
      paymentId: payment.paymentId,
      chargedAmountMinor: payment.amountMinor,
      chargedCurrency: 'USD',
    });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'paid', $2, $3::int, now(), '{}'::jsonb)`,
      [payment.paymentId, `pe-${idem}`, payment.amountMinor],
    );
    return booking.ref;
  }

  /** Push an occurrence inside the 24h window without faking a clock. */
  async function moveOccurrenceClose(occ: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(
      `update session_occurrences set starts_at = now() + interval '6 hours' where id = $1`,
      [occ],
    );
  }

  // Reads run as the owner (staff) so RLS never hides ground truth from the assertion.
  const usedCap = async (occ: string): Promise<number> => {
    await db.asOwner();
    return (await db.pg.query<{ n: number }>(`select used_capacity($1::uuid) as n`, [occ])).rows[0]!
      .n;
  };
  const occurrenceOf = async (ref: string): Promise<string> => {
    await db.asOwner();
    return (
      await db.pg.query<{ occ: string }>(
        `select bi.session_occurrence_id as occ from booking_items bi
           join bookings b on b.id = bi.booking_id where b.ref = $1 limit 1`,
        [ref],
      )
    ).rows[0]!.occ;
  };
  const bookingJson = async (ref: string): Promise<Record<string, unknown>> => {
    await db.asOwner();
    return await call<Record<string, unknown>>(db, 'api_get_booking', { ref });
  };
  const notifCount = async (ref: string, template: string): Promise<number> => {
    await db.asOwner();
    return (
      await db.pg.query<{ n: number }>(
        `select count(*)::int as n from notification_outbox
          where template = $2 and booking_id = (select id from bookings where ref = $1)`,
        [ref, template],
      )
    ).rows[0]!.n;
  };
  const occStatus = async (occ: string): Promise<string> => {
    await db.asOwner();
    return (
      await db.pg.query<{ status: string }>(
        `select status from session_occurrences where id = $1`,
        [occ],
      )
    ).rows[0]!.status;
  };

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!
      .id;
    for (const u of [CUSTOMER, OTHER]) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [u]);
      await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [u]);
    }
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff')`, [STAFF]);

    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pickup_available)
         values ($1, 'sunset-cruise', 'activity', 'Sunset Cruise', 'Cruises', 'published', false)
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    optId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    // A second option on the SAME activity — the cross-option target for the price-safety guard.
    otherOptId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Private') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    for (const o of [optId, otherOptId]) {
      await db.pg.query(
        `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
         values ($1, 'Adult', 5000, null)`,
        [o],
      );
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('moves a booking to another date on the same option — seats follow, both parties mailed', async () => {
    const from = await makeOccurrence('10 days');
    const to = await makeOccurrence('12 days');
    const ref = await bookConfirm(from, 'move-ok');
    expect(await usedCap(from)).toBe(2);
    expect(await usedCap(to)).toBe(0);
    expect((await bookingJson(ref)).reschedulable).toBe(true);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const res = await call<{ occurrenceId: string }>(db, 'api_reschedule_booking', {
      ref,
      occurrenceId: to,
    });
    expect(res.occurrenceId).toBe(to);

    expect(await occurrenceOf(ref)).toBe(to);
    expect(await usedCap(from)).toBe(0); // the old seat is released for resale
    expect(await usedCap(to)).toBe(2); // ...and taken on the new date
    expect(await notifCount(ref, 'booking_rescheduled')).toBe(1);
    expect(await notifCount(ref, 'owner_date_changed')).toBe(2); // owner email + telegram
  });

  it('is idempotent — rescheduling onto the date it is already on does not re-mail', async () => {
    const from = await makeOccurrence('10 days');
    const to = await makeOccurrence('12 days');
    const ref = await bookConfirm(from, 'move-idem');
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_reschedule_booking', { ref, occurrenceId: to });
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const second = await call<{ alreadyOnDate: boolean }>(db, 'api_reschedule_booking', {
      ref,
      occurrenceId: to,
    });
    expect(second.alreadyOnDate).toBe(true);
    expect(await notifCount(ref, 'booking_rescheduled')).toBe(1); // still exactly one
  });

  it('refuses a target on a DIFFERENT option — that would change the price', async () => {
    const from = await makeOccurrence('10 days');
    const to = await makeOccurrence('12 days', 5, otherOptId);
    const ref = await bookConfirm(from, 'move-opt');

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(call(db, 'api_reschedule_booking', { ref, occurrenceId: to })).rejects.toThrow(
      /option_mismatch/,
    );
    expect(await occurrenceOf(ref)).toBe(from); // untouched
  });

  it('refuses a target without room for the whole party', async () => {
    const from = await makeOccurrence('10 days');
    const to = await makeOccurrence('12 days', 1); // one seat, party of two
    const ref = await bookConfirm(from, 'move-full');

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(call(db, 'api_reschedule_booking', { ref, occurrenceId: to })).rejects.toThrow(
      /insufficient_capacity/,
    );
    expect(await occurrenceOf(ref)).toBe(from); // untouched
    expect(await usedCap(to)).toBe(0);
  });

  it('closes the free-change window 24h before the trip', async () => {
    const from = await makeOccurrence('10 days');
    const to = await makeOccurrence('12 days');
    const ref = await bookConfirm(from, 'move-late');
    await moveOccurrenceClose(from);
    expect((await bookingJson(ref)).reschedulable).toBe(false);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(call(db, 'api_reschedule_booking', { ref, occurrenceId: to })).rejects.toThrow(
      /reschedule_window_passed/,
    );
    expect(await occurrenceOf(ref)).toBe(from); // untouched
  });

  it('refuses a stranger', async () => {
    const from = await makeOccurrence('10 days');
    const to = await makeOccurrence('12 days');
    const ref = await bookConfirm(from, 'move-stranger');

    await db.as({ sub: OTHER, role: 'authenticated' });
    await expect(call(db, 'api_reschedule_booking', { ref, occurrenceId: to })).rejects.toThrow(
      /forbidden/,
    );
    expect(await occurrenceOf(ref)).toBe(from); // not moved by the stranger
  });

  it('calls off a departure — cancels it, stamps every guest, mails them, and is idempotent', async () => {
    const from = await makeOccurrence('10 days');
    const ref = await bookConfirm(from, 'wx-fan');

    await db.as({ sub: STAFF, role: 'authenticated' });
    const res = await call<{ affected: number }>(db, 'api_weather_cancel_occurrence', {
      occurrenceId: from,
      reason: 'sea_conditions',
    });
    expect(res.affected).toBe(1);
    expect(await occStatus(from)).toBe('cancelled'); // nobody else can book the date
    expect(await notifCount(ref, 'booking_weather_disrupted')).toBe(1);

    const json = await bookingJson(ref);
    expect(json.status).toBe('confirmed'); // status deliberately unchanged
    expect((json.disruption as { reason: string }).reason).toBe('sea_conditions');

    await db.as({ sub: STAFF, role: 'authenticated' });
    const again = await call<{ alreadyCancelled: boolean; affected: number }>(
      db,
      'api_weather_cancel_occurrence',
      { occurrenceId: from, reason: 'sea_conditions' },
    );
    expect(again.alreadyCancelled).toBe(true);
    expect(again.affected).toBe(0);
    expect(await notifCount(ref, 'booking_weather_disrupted')).toBe(1); // not re-mailed
  });

  it('refuses a call-off from a non-staff caller', async () => {
    const from = await makeOccurrence('10 days');
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      call(db, 'api_weather_cancel_occurrence', { occurrenceId: from, reason: 'weather' }),
    ).rejects.toThrow(/forbidden/);
    expect(await occStatus(from)).toBe('open');
  });

  it('a called-off guest can still move INSIDE the 24h window, and the stamp is resolved', async () => {
    const from = await makeOccurrence('10 days');
    const to = await makeOccurrence('12 days');
    const ref = await bookConfirm(from, 'wx-move');
    await moveOccurrenceClose(from); // the trip is 6 hours away — normally frozen

    await db.as({ sub: STAFF, role: 'authenticated' });
    await call(db, 'api_weather_cancel_occurrence', { occurrenceId: from, reason: 'weather' });
    // The stamp re-opens both self-service doors that the window had closed.
    const stamped = await bookingJson(ref);
    expect(stamped.reschedulable).toBe(true);
    expect(stamped.cancellable).toBe(true);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_reschedule_booking', { ref, occurrenceId: to });
    expect(await occurrenceOf(ref)).toBe(to);

    const after = await bookingJson(ref);
    expect((after.disruption as { resolution: string }).resolution).toBe('rescheduled');
    expect((after.disruption as { resolvedAt: string | null }).resolvedAt).not.toBeNull();
  });

  it('a called-off guest can still refund INSIDE the 24h window', async () => {
    const from = await makeOccurrence('10 days');
    const ref = await bookConfirm(from, 'wx-refund');
    await moveOccurrenceClose(from);

    await db.as({ sub: STAFF, role: 'authenticated' });
    await call(db, 'api_weather_cancel_occurrence', { occurrenceId: from, reason: 'weather' });

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const res = await call<{ status: string }>(db, 'api_cancel_booking', { ref });
    expect(res.status).toBe('refund_pending');

    const after = await bookingJson(ref);
    expect((after.disruption as { resolution: string }).resolution).toBe('refunded');
  });

  it('a self-cancel now mails the CUSTOMER, not just the owner (regression)', async () => {
    const occ = await makeOccurrence('10 days');
    const ref = await bookConfirm(occ, 'cust-mail');

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_cancel_booking', { ref });

    // The owner alert suppresses the refund_pending trigger's generic block, and that block used to
    // hold the ONLY customer-facing email — so the guest was told nothing at all.
    expect(await notifCount(ref, 'booking_cancellation')).toBe(1); // owner
    expect(await notifCount(ref, 'booking_cancelled_confirmation')).toBe(1); // customer
    expect(await notifCount(ref, 'booking_refund_pending')).toBe(0); // trio still suppressed
  });

  it('gates capacity on booking UNITS, not people — a 6-guest van needs one slot, not six', async () => {
    const from = await makeOccurrence('10 days');
    const to = await makeOccurrence('12 days', 1); // ONE unit free
    const ref = await bookConfirm(from, 'units');

    // Reshape the line the way create_booking writes a vehicle/private booking: quantity = 1 (one van,
    // one trip) with the headcount in pax. occurrence.capacity and used_capacity() are denominated in
    // those units — 'daily_capacity counts vehicles, not people'.
    await db.asOwner();
    await db.pg.query(
      `update booking_items set quantity = 1, pax = 6
        where booking_id = (select id from bookings where ref = $1)`,
      [ref],
    );
    expect(await usedCap(from)).toBe(1); // one unit, six people

    // Gating on the headcount would demand 6 free vans for a party that only ever consumed 1, and
    // would make any party larger than daily_capacity permanently un-reschedulable.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_reschedule_booking', { ref, occurrenceId: to });
    expect(await occurrenceOf(ref)).toBe(to);
    expect(await usedCap(to)).toBe(1);
  });

  it('re-stamps a guest whose REPLACEMENT date is also called off', async () => {
    const o1 = await makeOccurrence('10 days');
    const o2 = await makeOccurrence('12 days');
    const ref = await bookConfirm(o1, 'twice');

    await db.as({ sub: STAFF, role: 'authenticated' });
    await call(db, 'api_weather_cancel_occurrence', { occurrenceId: o1, reason: 'weather' });
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_reschedule_booking', { ref, occurrenceId: o2 });
    expect((await bookingJson(ref)).disruption).toMatchObject({ resolution: 'rescheduled' });

    // The cyclone comes back for the new date. A resolved stamp is non-null forever, so filtering the
    // fan-out on `disruption is null` skipped this guest entirely: no email, affected=0, and — because
    // the stamp is what unlocks the 24h bypass — no way to move or refund once the date closed in.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const res = await call<{ affected: number }>(db, 'api_weather_cancel_occurrence', {
      occurrenceId: o2,
      reason: 'sea_conditions',
    });
    expect(res.affected).toBe(1);
    expect(await notifCount(ref, 'booking_weather_disrupted')).toBe(2); // one per departure

    const json = await bookingJson(ref);
    expect(json.disruption).toMatchObject({ reason: 'sea_conditions', resolvedAt: null });
    expect(json.reschedulable).toBe(true); // both self-service doors re-open
    expect(json.cancellable).toBe(true);
  });

  it('exposes the slug, option and party size the confirmation page needs to offer new dates', async () => {
    const occ = await makeOccurrence('10 days');
    const ref = await bookConfirm(occ, 'dto');
    const json = await bookingJson(ref);
    expect(json.activitySlug).toBe('sunset-cruise');
    expect(json.activityOptionId).toBe(optId);
    expect(Number(json.partySize)).toBe(2);
  });
});
