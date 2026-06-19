import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Drop-off is its own field — NOT concatenated into pickup_location. A booking can also be
 * marked "pickup to be arranged" (pickup_pending) which is distinct from "no pickup".
 *   api_book stores dropoffLocation + pickupPending → booking_json (via api_get_booking)
 *   reads them back round-tripping; the pickup address stays clean.
 */
const CUSTOMER = 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('booking drop-off: distinct dropoff_location + pickup_pending', () => {
  let db: TestDb;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into operators (name, slug) values ('Dropoff Tours', 'dropoff-tours')`);
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);

    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'dropoff-tour', 'activity', 'Dropoff Tour', 'Sightseeing tours', 'published') returning id`,
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

  it('stores drop-off as its own field, distinct from the pickup address', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 1 },
      pickupLocation: 'Flic en Flac, Le Cardinal Villa',
      dropoffLocation: 'SSR International Airport',
      pickupPending: false,
      customerName: 'Dropoff Tester',
      customerEmail: 'dropoff@example.com',
      source: 'web',
      idempotencyKey: 'drop-distinct-12345678',
    });

    const got = await call<{ pickupLocation: string | null; dropoffLocation: string | null; pickupPending: boolean }>(
      db,
      'api_get_booking',
      { ref: booking.ref },
    );
    // Drop-off round-trips on its own field.
    expect(got.dropoffLocation).toBe('SSR International Airport');
    // The pickup address is the pickup address — drop-off was NOT merged into it.
    expect(got.pickupLocation).toBe('Flic en Flac, Le Cardinal Villa');
    expect(got.pickupLocation).not.toContain('drop-off');
    expect(got.pickupLocation).not.toContain('SSR International Airport');
    expect(got.pickupPending).toBe(false);
  });

  it('marks pickup_pending when the pickup is to be arranged, with no pickup address', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 1 },
      pickupPending: true,
      customerName: 'TBD Tester',
      customerEmail: 'tbd@example.com',
      source: 'web',
      idempotencyKey: 'drop-pending-12345678',
    });

    const got = await call<{ pickupLocation: string | null; pickupPending: boolean }>(db, 'api_get_booking', {
      ref: booking.ref,
    });
    expect(got.pickupPending).toBe(true);
    expect(got.pickupLocation).toBeNull();
  });

  it('defaults pickup_pending to false and dropoff to null when neither is sent', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 1 },
      customerName: 'Plain Tester',
      customerEmail: 'plain@example.com',
      source: 'web',
      idempotencyKey: 'drop-plain-123456789',
    });

    const got = await call<{ dropoffLocation: string | null; pickupPending: boolean }>(db, 'api_get_booking', {
      ref: booking.ref,
    });
    expect(got.dropoffLocation).toBeNull();
    expect(got.pickupPending).toBe(false);
  });
});
