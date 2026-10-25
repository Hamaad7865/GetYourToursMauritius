import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { mapDbError } from '@/lib/services/db-errors';
import type { ServiceError } from '@/lib/services/errors';

/**
 * Moving an airport transfer keeps its first-leg date on the slot (20261025130000).
 *
 * The day-slot is the only date a transfer's first leg has; a departure's hotel pickup and a return's
 * second leg both ride in bookings.return_date. api_reschedule_booking used to repoint booking_items
 * and leave return_date behind, so moving a departure put the slot on the new day and the pickup on
 * the old one — the shape of prod BMT61C672F6CC1B6 (slot 9 Oct, left 15 Oct). Now a departure's
 * return_date is SET to the new slot's Mauritius day, a return keeps its second leg but may not be
 * moved past it, and an arrival is untouched. Change-of-tour cannot reach a transfer at all.
 *
 * Every day is read back from Postgres (starts_at at Indian/Mauritius), never computed in JS.
 */

const CUSTOMER = 'f3f3f3f3-f3f3-f3f3-f3f3-f3f3f3f3f3f3';
const STAFF = 'f4f4f4f4-f4f4-f4f4-f4f4-f4f4f4f4f4f4';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('api_reschedule_booking: an airport transfer’s first-leg date follows its slot', () => {
  let db: TestDb;
  let operatorId: string;
  let optionId: string;
  /** Noon-Mauritius slots 3, 6, 9 and 12 days out — all well clear of the 24h window. */
  const occ: Record<number, string> = {};
  const day: Record<number, string> = {};
  let seq = 0;

  async function owner<T>(text: string, params: unknown[] = []): Promise<T> {
    await db.asOwner();
    return (await db.pg.query<T>(text, params)).rows[0]!;
  }

  /** Book a transfer as the customer, pay, and confirm via the verified webhook path. */
  async function bookConfirm(occurrenceId: string, extra: Record<string, unknown>) {
    seq += 1;
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      expectedSlug: 'airport-transfer',
      party: { Transfer: 2 },
      dropoffSlug: 'shandrani-beachcomber',
      customerName: 'Move Tester',
      customerEmail: 'move@example.com',
      source: 'web',
      idempotencyKey: `move-transfer-${seq}-0000`,
      ...extra,
    });
    const payment = await call<{ paymentId: string; amountMinor: number }>(
      db,
      'api_create_payment',
      { bookingRef: booking.ref, idempotencyKey: `move-transfer-pay-${seq}` },
    );
    await db.as({ sub: 'service', role: 'service_role' });
    await call(db, 'api_record_payment_charge', {
      paymentId: payment.paymentId,
      chargedAmountMinor: payment.amountMinor,
      chargedCurrency: 'USD',
    });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'paid', $2, $3::int, now(), '{}'::jsonb)`,
      [payment.paymentId, `move-transfer-pe-${seq}`, payment.amountMinor],
    );
    return booking.ref;
  }

  async function move(ref: string, occurrenceId: string, as: string = STAFF) {
    await db.as({ sub: as, role: 'authenticated' });
    return call<{ ok: boolean }>(db, 'api_reschedule_booking', { ref, occurrenceId });
  }

  async function state(ref: string) {
    return owner<{ occ: string; return_date: string | null; mails: number }>(
      `select (select bi.session_occurrence_id from booking_items bi where bi.booking_id = b.id limit 1) as occ,
              b.return_date::text as return_date,
              (select count(*)::int from notification_outbox n
                where n.booking_id = b.id and n.template = 'booking_rescheduled') as mails
         from bookings b where b.ref = $1`,
      [ref],
    );
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    operatorId = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours') returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [CUSTOMER, STAFF]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer'), ($2, 'staff')`, [
      CUSTOMER,
      STAFF,
    ]);
    // The airport-transfer product lives in seed.sql, not the migrations — the same vehicle-mode
    // shape prod runs (one product, is_airport_transfer, pricing_mode 'vehicle').
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode, is_airport_transfer)
         values ($1, 'airport-transfer', 'transport', 'Airport Transfer', 'Airport transfers', 'published', 'vehicle', true)
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Per transfer') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
       values ($1, 'Transfer', 3600, null)`,
      [optionId],
    );
    for (const n of [3, 6, 9, 12]) {
      const row = (
        await db.pg.query<{ id: string; d: string }>(
          `with s as (select ((current_date + $3::int) + time '12:00') at time zone 'Indian/Mauritius' as t)
           insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
           select $1, $2, s.t, s.t + interval '1 hour', 40 from s
           returning id, (starts_at at time zone 'Indian/Mauritius')::date::text as d`,
          [optionId, operatorId, n],
        )
      ).rows[0]!;
      occ[n] = row.id;
      day[n] = row.d;
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('staff moving a departure carries its hotel pickup date to the new slot', async () => {
    const ref = await bookConfirm(occ[3]!, { tripDirection: 'departure', returnDate: day[3] });
    await move(ref, occ[9]!);
    expect(await state(ref)).toMatchObject({ occ: occ[9], return_date: day[9] });
  });

  it('the owner moving their own departure gets the same', async () => {
    const ref = await bookConfirm(occ[3]!, { tripDirection: 'departure', returnDate: day[3] });
    await move(ref, occ[6]!, CUSTOMER);
    expect(await state(ref)).toMatchObject({ occ: occ[6], return_date: day[6] });
  });

  it('repairs the prod shape: moving the slot onto the real departure day leaves them agreeing', async () => {
    const ref = await bookConfirm(occ[3]!, { tripDirection: 'departure', returnDate: day[3] });
    // What BMT61C672F6CC1B6 looked like before api_book's guard: slot on one day, pickup six later.
    await owner(`update bookings set return_date = $2::date where ref = $1 returning id`, [
      ref,
      day[9],
    ]);
    await move(ref, occ[9]!);
    expect(await state(ref)).toMatchObject({ occ: occ[9], return_date: day[9] });
  });

  it('a return keeps its second leg when the arrival moves, earlier or later', async () => {
    const ref = await bookConfirm(occ[6]!, { tripDirection: 'return', returnDate: day[12] });
    await move(ref, occ[3]!);
    expect(await state(ref)).toMatchObject({ occ: occ[3], return_date: day[12] });
    await move(ref, occ[9]!);
    expect(await state(ref)).toMatchObject({ occ: occ[9], return_date: day[12] });
  });

  it('refuses a return moved past its own departure leg — nothing moves, nobody is mailed', async () => {
    const ref = await bookConfirm(occ[3]!, { tripDirection: 'return', returnDate: day[6] });
    const raw = await move(ref, occ[9]!).then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(raw instanceof Error ? raw.message : raw)).toMatch(
      /transfer_return_before_arrival/,
    );
    expect(await state(ref)).toEqual({ occ: occ[3], return_date: day[6], mails: 0 });

    let mapped: ServiceError | null = null;
    try {
      mapDbError(raw);
    } catch (e) {
      mapped = e as ServiceError;
    }
    expect(mapped?.status).toBe(409);
    expect(mapped?.message).toMatch(/return transfer/);

    // Arriving on the day it leaves is a same-day return, which api_book allows too.
    await move(ref, occ[6]!);
    expect(await state(ref)).toMatchObject({ occ: occ[6], return_date: day[6] });
  });

  it('a legacy row with only trip_type = return is held to the same rule', async () => {
    const ref = await bookConfirm(occ[3]!, { tripDirection: 'return', returnDate: day[6] });
    await owner(`update bookings set trip_direction = null where ref = $1 returning id`, [ref]);
    await expect(move(ref, occ[9]!)).rejects.toThrow(/transfer_return_before_arrival/);
  });

  it('a return with no second-leg date yet moves freely', async () => {
    const ref = await bookConfirm(occ[3]!, { tripDirection: 'return' });
    await move(ref, occ[12]!);
    expect(await state(ref)).toMatchObject({ occ: occ[12], return_date: null });
  });

  it('leaves an arrival’s dates alone', async () => {
    const plain = await bookConfirm(occ[3]!, { tripDirection: 'arrival' });
    await move(plain, occ[6]!);
    expect(await state(plain)).toMatchObject({ occ: occ[6], return_date: null });
    // A stray returnDate on an arrival is not a first-leg date, so the move does not rewrite it.
    const stray = await bookConfirm(occ[3]!, { tripDirection: 'arrival', returnDate: day[12] });
    await move(stray, occ[9]!);
    expect(await state(stray)).toMatchObject({ occ: occ[9], return_date: day[12] });
  });

  // apply_booking_change repoints booking_items and never touches return_date either. It is safe only
  // because change_request_quote refuses every vehicle-mode source, and every airport transfer is
  // vehicle-mode. If that refusal is ever relaxed for vehicle ↔ vehicle moves, this goes red: teach
  // apply_booking_change the same return_date rule as api_reschedule_booking first.
  it('change-of-tour cannot reach an airport transfer', async () => {
    const ref = await bookConfirm(occ[3]!, { tripDirection: 'departure', returnDate: day[3] });
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      call(db, 'api_propose_booking_change', { ref, occurrenceId: occ[6] }),
    ).rejects.toThrow(/not_changeable/);
  });
});
