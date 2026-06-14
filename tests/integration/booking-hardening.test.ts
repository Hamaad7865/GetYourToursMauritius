import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

describe('booking core hardening', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('prices from the DB, ignoring any client-supplied amount', async () => {
    const { occurrenceId, optionId } = await seedOccurrence(db, 10);
    const { rows: hold } = await db.pg.query<{ id: string }>(
      `select * from create_hold($1, $2, $3)`,
      [occurrenceId, 2, 'harden-price'],
    );
    // Client tries to pay 1 minor unit each; the RPC must use the DB price (7500).
    const items = [
      { price_label: 'Adult', quantity: 2, unit_amount_minor: 1, activity_option_id: 'spoofed' },
    ];
    const { rows: booking } = await db.pg.query<{ id: string; total_minor: number }>(
      `select * from create_booking($1, $2, $3, $4, $5, $6::booking_source, $7::jsonb)`,
      [
        'harden-price-bk',
        hold[0]!.id,
        'Eve',
        'eve@example.com',
        null,
        'web',
        JSON.stringify(items),
      ],
    );
    expect(booking[0]!.total_minor).toBe(15000); // 2 × 7500, not 2 × 1

    const { rows: bi } = await db.pg.query<{
      unit_amount_minor: number;
      activity_option_id: string;
    }>(`select unit_amount_minor, activity_option_id from booking_items where booking_id = $1`, [
      booking[0]!.id,
    ]);
    expect(bi[0]!.unit_amount_minor).toBe(7500);
    expect(bi[0]!.activity_option_id).toBe(optionId); // forced to the occurrence's option
  });

  it('rejects an unknown price tier', async () => {
    const { occurrenceId } = await seedOccurrence(db, 10);
    const { rows: hold } = await db.pg.query<{ id: string }>(
      `select * from create_hold($1, $2, $3)`,
      [occurrenceId, 2, 'harden-unknown'],
    );
    const items = [{ price_label: 'Senior', quantity: 2 }];
    await expect(
      db.pg.query(
        `select * from create_booking($1, $2, $3, $4, $5, $6::booking_source, $7::jsonb)`,
        [
          'harden-unknown-bk',
          hold[0]!.id,
          'X',
          'x@example.com',
          null,
          'web',
          JSON.stringify(items),
        ],
      ),
    ).rejects.toThrow(/unknown_price_tier/);
  });

  it('enforces per-tier max_guests', async () => {
    const { occurrenceId, optionId } = await seedOccurrence(db, 10);
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests) values ($1, 'Private group', 30000, 2)`,
      [optionId],
    );
    const { rows: hold } = await db.pg.query<{ id: string }>(
      `select * from create_hold($1, $2, $3)`,
      [occurrenceId, 3, 'harden-max'],
    );
    const items = [{ price_label: 'Private group', quantity: 3 }];
    await expect(
      db.pg.query(
        `select * from create_booking($1, $2, $3, $4, $5, $6::booking_source, $7::jsonb)`,
        ['harden-max-bk', hold[0]!.id, 'X', 'x@example.com', null, 'web', JSON.stringify(items)],
      ),
    ).rejects.toThrow(/exceeds_max_guests/);
  });

  it('does not confirm a booking on partial payment, but does on full payment', async () => {
    const { occurrenceId } = await seedOccurrence(db, 10);
    const { rows: hold } = await db.pg.query<{ id: string }>(
      `select * from create_hold($1, $2, $3)`,
      [occurrenceId, 2, 'harden-pay'],
    );
    const items = [{ price_label: 'Adult', quantity: 2 }];
    const { rows: booking } = await db.pg.query<{ id: string; total_minor: number }>(
      `select * from create_booking($1, $2, $3, $4, $5, $6::booking_source, $7::jsonb)`,
      ['harden-pay-bk', hold[0]!.id, 'Pat', 'pat@example.com', null, 'web', JSON.stringify(items)],
    );
    const bookingId = booking[0]!.id;
    const total = booking[0]!.total_minor; // 15000

    const { rows: pay } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor) values ($1, 'harden-pay-p', $2) returning id`,
      [bookingId, total],
    );
    const paymentId = pay[0]!.id;

    // Partial payment: must NOT confirm.
    const { rows: partial } = await db.pg.query<{ status: string }>(
      `select * from append_payment_event($1, 'paid', 'evt-partial', $2, now(), '{}'::jsonb)`,
      [paymentId, 10000],
    );
    expect(partial[0]!.status).toBe('pending');
    const { rows: b1 } = await db.pg.query<{ status: string }>(
      `select status from bookings where id = $1`,
      [bookingId],
    );
    expect(b1[0]!.status).toBe('payment_pending');

    // Remaining payment brings it to the full amount: now it confirms.
    const { rows: full } = await db.pg.query<{ status: string }>(
      `select * from append_payment_event($1, 'paid', 'evt-rest', $2, now(), '{}'::jsonb)`,
      [paymentId, 5000],
    );
    expect(full[0]!.status).toBe('paid');
    const { rows: b2 } = await db.pg.query<{ status: string }>(
      `select status from bookings where id = $1`,
      [bookingId],
    );
    expect(b2[0]!.status).toBe('confirmed');
  });

  it('refuses to hold an occurrence in the past', async () => {
    const { occurrenceId } = await seedOccurrence(db, 10);
    await db.pg.query(
      `update session_occurrences set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = $1`,
      [occurrenceId],
    );
    await expect(
      db.pg.query(`select * from create_hold($1, $2, $3)`, [occurrenceId, 1, 'harden-past']),
    ).rejects.toThrow(/occurrence_in_past/);
  });
});
