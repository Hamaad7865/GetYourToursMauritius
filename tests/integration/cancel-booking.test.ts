import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Customer self-service cancel → refund. api_cancel_booking lets a confirmed+paid booking, more than 24h
 * before the trip, be cancelled by its OWNER (the customer) to refund_pending — freeing the seat and
 * enqueuing an owner heads-up. It rejects: inside the 24h window, unpaid/unconfirmed, and non-owners; and
 * is idempotent. booking_json.cancellable mirrors the same eligibility for the UI.
 */
const CUSTOMER = 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9';
const OTHER = 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [JSON.stringify(params)]);
  return rows[0]!.data;
}

describe('api_cancel_booking — customer self-service cancel + refund_pending', () => {
  let db: TestDb;
  let operatorId: string;
  let optId: string;

  async function makeOccurrence(interval: string, capacity = 5): Promise<string> {
    await db.asOwner(); // occurrences are owner-managed (RLS); reset the role after a prior test left it
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
       values ($1, $2, now() + interval '${interval}', now() + interval '${interval}' + interval '2 hours', $3)
       returning id`,
      [optId, operatorId, capacity],
    );
    return rows[0]!.id;
  }

  /** Book 2 adults as the customer, pay, and confirm via the verified webhook path. Returns the ref. */
  async function bookConfirm(occurrenceId: string, idem: string): Promise<string> {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 2 },
      customerName: 'Jean Dupont',
      customerEmail: 'jean@example.com',
      source: 'web',
      idempotencyKey: `book-${idem}`,
    });
    const payment = await call<{ paymentId: string; amountMinor: number }>(db, 'api_create_payment', {
      bookingRef: booking.ref,
      idempotencyKey: `pay-${idem}`,
    });
    await call(db, 'api_record_payment_charge', {
      paymentId: payment.paymentId,
      chargedAmountMinor: payment.amountMinor,
      chargedCurrency: 'USD',
    });
    await db.as({ sub: 'service', role: 'service_role' });
    await db.pg.query(`select append_payment_event($1::uuid, 'paid', $2, $3::int, now(), '{}'::jsonb)`, [
      payment.paymentId,
      `pe-${idem}`,
      payment.amountMinor,
    ]);
    return booking.ref;
  }

  async function bookOnly(occurrenceId: string, idem: string): Promise<string> {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 2 },
      customerName: 'Jean Dupont',
      customerEmail: 'jean@example.com',
      source: 'web',
      idempotencyKey: `book-${idem}`,
    });
    return booking.ref;
  }

  // Reads run as the owner (staff) so RLS never hides ground truth from the assertion.
  const statusOf = async (ref: string): Promise<string> => {
    await db.asOwner();
    return (await db.pg.query<{ status: string }>(`select status from bookings where ref = $1`, [ref])).rows[0]!.status;
  };
  const usedCap = async (occ: string): Promise<number> => {
    await db.asOwner();
    return (await db.pg.query<{ n: number }>(`select used_capacity($1::uuid) as n`, [occ])).rows[0]!.n;
  };
  const cancellableFlag = async (ref: string): Promise<boolean> => {
    await db.asOwner();
    return (await call<{ cancellable: boolean }>(db, 'api_get_booking', { ref })).cancellable;
  };
  const cancellationNotifs = async (ref: string): Promise<number> => {
    await db.asOwner();
    return (
      await db.pg.query<{ n: number }>(
        `select count(*)::int as n from notification_outbox where template = 'booking_cancellation' and booking_id = (select id from bookings where ref = $1)`,
        [ref],
      )
    ).rows[0]!.n;
  };

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`);
    operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!.id;
    for (const u of [CUSTOMER, OTHER]) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [u]);
      await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [u]);
    }
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
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
       values ($1, 'Adult', 5000, null)`,
      [optId],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('cancels a confirmed+paid booking >24h out → refund_pending, frees the seat, notifies the owner', async () => {
    const occ = await makeOccurrence('5 days');
    const ref = await bookConfirm(occ, 'ok');
    expect(await statusOf(ref)).toBe('confirmed');
    expect(await usedCap(occ)).toBe(2); // two adults hold the seats

    expect(await cancellableFlag(ref)).toBe(true); // booking_json says it's cancellable

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const res = await call<{ status: string }>(db, 'api_cancel_booking', { ref });
    expect(res.status).toBe('refund_pending');

    expect(await statusOf(ref)).toBe('refund_pending');
    expect(await usedCap(occ)).toBe(0); // the seats are freed for resale
    expect(await cancellableFlag(ref)).toBe(false); // no longer cancellable
    expect(await cancellationNotifs(ref)).toBe(1); // one owner heads-up enqueued
  });

  it('is idempotent — a second cancel returns the current state and does not re-enqueue', async () => {
    const occ = await makeOccurrence('5 days');
    const ref = await bookConfirm(occ, 'idem');
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_cancel_booking', { ref });
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const second = await call<{ alreadyCancelled: boolean; status: string }>(db, 'api_cancel_booking', { ref });
    expect(second.alreadyCancelled).toBe(true);
    expect(second.status).toBe('refund_pending');
    expect(await cancellationNotifs(ref)).toBe(1); // still exactly one cancellation heads-up
  });

  it('rejects a cancel inside the 24-hour window', async () => {
    const occ = await makeOccurrence('5 days');
    const ref = await bookConfirm(occ, 'near');
    // Simulate the trip approaching: move the occurrence to 6 hours away.
    await db.asOwner();
    await db.pg.query(`update session_occurrences set starts_at = now() + interval '6 hours' where id = $1`, [occ]);
    // booking_json reflects the closed window.
    expect(await cancellableFlag(ref)).toBe(false);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(call(db, 'api_cancel_booking', { ref })).rejects.toThrow(/cancellation_window_passed/);
    expect(await statusOf(ref)).toBe('confirmed'); // untouched
  });

  it('rejects a cancel on an unpaid booking', async () => {
    const occ = await makeOccurrence('5 days');
    const ref = await bookOnly(occ, 'unpaid'); // booked, not paid → payment_pending
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(call(db, 'api_cancel_booking', { ref })).rejects.toThrow(/not_cancellable/);
  });

  it('rejects a cancel by someone who is not the booking owner', async () => {
    const occ = await makeOccurrence('5 days');
    const ref = await bookConfirm(occ, 'owner');
    await db.as({ sub: OTHER, role: 'authenticated' });
    await expect(call(db, 'api_cancel_booking', { ref })).rejects.toThrow(/forbidden/);
    expect(await statusOf(ref)).toBe('confirmed'); // not cancelled by the stranger
  });
});
