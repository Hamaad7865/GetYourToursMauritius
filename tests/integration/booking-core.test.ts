import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

async function usedCapacity(db: TestDb, occurrenceId: string): Promise<number> {
  const { rows } = await db.pg.query<{ u: number }>(`select used_capacity($1) as u`, [
    occurrenceId,
  ]);
  return Number(rows[0]!.u);
}

describe('booking core RPCs', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  describe('create_hold', () => {
    it('reserves capacity, rejects oversell, and is idempotent', async () => {
      const { occurrenceId } = await seedOccurrence(db, 10);

      const { rows: h1 } = await db.pg.query<{ quantity: number }>(
        `select * from create_hold($1, $2, $3)`,
        [occurrenceId, 6, 'hold-A'],
      );
      expect(h1[0]!.quantity).toBe(6);
      expect(await usedCapacity(db, occurrenceId)).toBe(6);

      // idempotent replay: same key, no second reservation
      await db.pg.query(`select * from create_hold($1, $2, $3)`, [occurrenceId, 6, 'hold-A']);
      expect(await usedCapacity(db, occurrenceId)).toBe(6);

      // oversell: only 4 left
      await expect(
        db.pg.query(`select * from create_hold($1, $2, $3)`, [occurrenceId, 6, 'hold-B']),
      ).rejects.toThrow(/insufficient_capacity/);

      // exact fill
      const { rows: h3 } = await db.pg.query<{ quantity: number }>(
        `select * from create_hold($1, $2, $3)`,
        [occurrenceId, 4, 'hold-C'],
      );
      expect(h3[0]!.quantity).toBe(4);
      expect(await usedCapacity(db, occurrenceId)).toBe(10);
    });

    it('rejects non-positive quantity and closed occurrences', async () => {
      const { occurrenceId } = await seedOccurrence(db, 5);
      await expect(
        db.pg.query(`select * from create_hold($1, $2, $3)`, [occurrenceId, 0, 'q0']),
      ).rejects.toThrow(/invalid_quantity/);

      await db.pg.query(`update session_occurrences set status = 'closed' where id = $1`, [
        occurrenceId,
      ]);
      await expect(
        db.pg.query(`select * from create_hold($1, $2, $3)`, [occurrenceId, 1, 'closed']),
      ).rejects.toThrow(/occurrence_not_bookable/);
    });
  });

  describe('create_booking + payment confirmation', () => {
    it('books a hold, confirms on paid, consumes the hold, and keeps capacity exact', async () => {
      const { occurrenceId, optionId } = await seedOccurrence(db, 10);

      const { rows: hold } = await db.pg.query<{ id: string }>(
        `select * from create_hold($1, $2, $3)`,
        [occurrenceId, 6, 'bk-hold'],
      );
      const holdId = hold[0]!.id;

      const items = [
        {
          activity_option_id: optionId,
          price_label: 'Adult',
          quantity: 6,
          unit_amount_minor: 7500,
        },
      ];
      const { rows: booking } = await db.pg.query<{
        id: string;
        status: string;
        total_minor: number;
      }>(`select * from create_booking($1, $2, $3, $4, $5, $6::booking_source, $7::jsonb)`, [
        'booking-1',
        holdId,
        'Asha T',
        'asha@example.com',
        null,
        'web',
        JSON.stringify(items),
      ]);
      expect(booking[0]!.status).toBe('payment_pending');
      expect(booking[0]!.total_minor).toBe(45000);
      const bookingId = booking[0]!.id;

      // idempotent create_booking
      const { rows: replay } = await db.pg.query<{ id: string }>(
        `select * from create_booking($1, $2, $3, $4, $5, $6::booking_source, $7::jsonb)`,
        ['booking-1', holdId, 'Asha T', 'asha@example.com', null, 'web', JSON.stringify(items)],
      );
      expect(replay[0]!.id).toBe(bookingId);

      // still reserved by the active hold while pending
      expect(await usedCapacity(db, occurrenceId)).toBe(6);

      // create the payment row (in real flow createPaymentLink does this), then confirm via webhook
      const { rows: pay } = await db.pg.query<{ id: string }>(
        `insert into payments (booking_id, idempotency_key, amount_minor) values ($1, 'pay-1', 45000) returning id`,
        [bookingId],
      );
      const paymentId = pay[0]!.id;

      const { rows: confirmed } = await db.pg.query<{ status: string; paid_minor: number }>(
        `select * from append_payment_event($1, $2, $3, $4, $5::timestamptz, $6::jsonb)`,
        [paymentId, 'paid', 'evt-paid-1', 45000, new Date().toISOString(), '{}'],
      );
      expect(confirmed[0]!.status).toBe('paid');
      expect(confirmed[0]!.paid_minor).toBe(45000);

      const { rows: b2 } = await db.pg.query<{ status: string; payment_state: string }>(
        `select status, payment_state from bookings where id = $1`,
        [bookingId],
      );
      expect(b2[0]!.status).toBe('confirmed');
      expect(b2[0]!.payment_state).toBe('paid');

      const { rows: h2 } = await db.pg.query<{ status: string }>(
        `select status from booking_holds where id = $1`,
        [holdId],
      );
      expect(h2[0]!.status).toBe('consumed');

      // capacity unchanged: confirmed items (6) now count, consumed hold does not
      expect(await usedCapacity(db, occurrenceId)).toBe(6);

      // duplicate webhook (same provider_event_id) is a no-op
      await db.pg.query(
        `select * from append_payment_event($1, $2, $3, $4, $5::timestamptz, $6::jsonb)`,
        [paymentId, 'paid', 'evt-paid-1', 45000, new Date().toISOString(), '{}'],
      );
      const { rows: events } = await db.pg.query<{ n: number }>(
        `select count(*)::int as n from payment_events where payment_id = $1 and provider_event_id = 'evt-paid-1'`,
        [paymentId],
      );
      expect(events[0]!.n).toBe(1);

      // refund -> refunded
      await db.pg.query(
        `select * from append_payment_event($1, $2, $3, $4, $5::timestamptz, $6::jsonb)`,
        [paymentId, 'refunded', 'evt-refund-1', 45000, new Date().toISOString(), '{}'],
      );
      const { rows: b3 } = await db.pg.query<{ status: string; payment_state: string }>(
        `select status, payment_state from bookings where id = $1`,
        [bookingId],
      );
      expect(b3[0]!.status).toBe('refunded');
      expect(b3[0]!.payment_state).toBe('refunded');
    });

    it('rejects an items/hold quantity mismatch', async () => {
      const { occurrenceId, optionId } = await seedOccurrence(db, 10);
      const { rows: hold } = await db.pg.query<{ id: string }>(
        `select * from create_hold($1, $2, $3)`,
        [occurrenceId, 4, 'mismatch-hold'],
      );
      const items = [
        {
          activity_option_id: optionId,
          price_label: 'Adult',
          quantity: 3,
          unit_amount_minor: 7500,
        },
      ];
      await expect(
        db.pg.query(
          `select * from create_booking($1, $2, $3, $4, $5, $6::booking_source, $7::jsonb)`,
          [
            'mismatch-booking',
            hold[0]!.id,
            'X',
            'x@example.com',
            null,
            'web',
            JSON.stringify(items),
          ],
        ),
      ).rejects.toThrow(/items_quantity_mismatch/);
    });
  });

  describe('expire_holds', () => {
    it('frees capacity once a hold is past its expiry', async () => {
      const { occurrenceId } = await seedOccurrence(db, 5);
      await db.pg.query(`select * from create_hold($1, $2, $3)`, [occurrenceId, 5, 'exp-hold']);
      expect(await usedCapacity(db, occurrenceId)).toBe(5);

      // push expiry into the past, then sweep
      await db.pg.query(
        `update booking_holds set expires_at = now() - interval '1 minute' where idempotency_key = 'exp-hold'`,
      );
      // lazy: capacity already ignores it
      expect(await usedCapacity(db, occurrenceId)).toBe(0);

      const { rows } = await db.pg.query<{ expire_holds: number }>(`select expire_holds()`);
      expect(Number(rows[0]!.expire_holds)).toBeGreaterThanOrEqual(1);

      const { rows: h } = await db.pg.query<{ status: string }>(
        `select status from booking_holds where idempotency_key = 'exp-hold'`,
      );
      expect(h[0]!.status).toBe('expired');
    });
  });
});
