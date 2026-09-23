import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { photographyDepositMinor } from '@/lib/catalogue/photography';

/**
 * Photography is paid in two halves (20261010000000_photography_deposit). Against the REAL schema:
 * the deferred trigger sets `deposit_minor` to half the FINAL total (supplements folded in), the first
 * charge create_payment opens is that deposit, settling it confirms the booking with the other half
 * still owed, the booking's OWNER can then open the balance, and settling that clears it. A tour
 * booking is untouched. The TS display mirror must produce the same figure the trigger charges.
 */
const CUSTOMER = 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

interface Row {
  id: string;
  total_minor: number;
  deposit_minor: number;
  balance_due_minor: number;
  status: string;
}

async function booking(db: TestDb, ref: string): Promise<Row> {
  await db.asOwner();
  const { rows } = await db.pg.query<Row>(
    `select id, total_minor::int, deposit_minor::int, balance_due_minor::int, status::text
       from bookings where ref = $1`,
    [ref],
  );
  return rows[0]!;
}

/** The newest payments row of a purpose — what create_payment opened. */
async function payment(db: TestDb, bookingId: string, purpose: string) {
  await db.asOwner();
  const { rows } = await db.pg.query<{ id: string; amount_minor: number }>(
    `select id, amount_minor::int from payments where booking_id = $1 and purpose = $2
      order by created_at desc limit 1`,
    [bookingId, purpose],
  );
  return rows[0]!;
}

async function settle(db: TestDb, paymentId: string, amount: number, evt: string) {
  await db.asOwner();
  await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
    paymentId,
    evt,
    amount,
  ]);
}

describe('photography: 50% to book, the rest on delivery', () => {
  let db: TestDb;
  let photoOcc: string;
  let tourOcc: string;
  let droneId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    const op = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours') returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);

    const occ = async (optionId: string) =>
      (
        await db.pg.query<{ id: string }>(
          `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
           values ($1, $2, now() + interval '5 days', now() + interval '5 days 2 hours', 4) returning id`,
          [optionId, op],
        )
      ).rows[0]!.id;

    // A package exactly as the admin template writes it: a private option (€150 covers 2, +€25 each
    // extra, max 8) and a per-shoot add-on.
    const photo = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'couples-shoot', 'activity', 'Couples shoot', 'Photography', 'published') returning id`,
        [op],
      )
    ).rows[0]!.id;
    const photoOpt = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name, private_base_minor, private_included,
                                       private_extra_minor, private_max_guests)
         values ($1, 'Private shoot', 15000, 2, 2500, 8) returning id`,
        [photo],
      )
    ).rows[0]!.id;
    droneId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_supplements (activity_id, name, price_minor, position)
         values ($1, 'Drone aerials', 12000, 0) returning id`,
        [photo],
      )
    ).rows[0]!.id;
    photoOcc = await occ(photoOpt);

    const tour = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'plain-tour', 'activity', 'Plain tour', 'Sightseeing tours', 'published') returning id`,
        [op],
      )
    ).rows[0]!.id;
    const tourOpt = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [tour],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 7001)`,
      [tourOpt],
    );
    tourOcc = await occ(tourOpt);
  });

  afterAll(async () => {
    await db.close();
  });

  it('sets the deposit to half the final total, takes it first, then lets the owner pay the rest', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: photoOcc,
      party: { 'Private shoot': 3 },
      supplements: [{ id: droneId, qty: 1 }],
      customerName: 'Photo Guest',
      customerEmail: 'photo@example.com',
      source: 'web',
      idempotencyKey: 'photo-deposit-0001',
    });

    const b = await booking(db, booked.ref);
    // €150 base + €25 for the third guest + €120 drone.
    expect(b.total_minor).toBe(29500);
    expect(b.deposit_minor).toBe(14750);
    expect(b.deposit_minor).toBe(photographyDepositMinor(b.total_minor));

    // The first charge is the deposit.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_create_payment', { bookingRef: booked.ref, idempotencyKey: 'photo-pay-1' });
    const dep = await payment(db, b.id, 'booking');
    expect(dep.amount_minor).toBe(14750);

    // Settling it confirms the booking with the other half still owed.
    await settle(db, dep.id, 14750, 'photo-evt-1');
    const confirmed = await booking(db, booked.ref);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.balance_due_minor).toBe(14750);

    // The OWNER opens the balance (photos delivered) — sized from the booking, never the caller.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_create_payment', {
      bookingRef: booked.ref,
      idempotencyKey: 'photo-bal-1',
      purpose: 'balance',
    });
    const bal = await payment(db, b.id, 'balance');
    expect(bal.amount_minor).toBe(14750);
    await settle(db, bal.id, 14750, 'photo-evt-2');
    const settled = await booking(db, booked.ref);
    expect(settled.balance_due_minor).toBe(0);
    expect(settled.status).toBe('confirmed');
  });

  it('rounds an odd total UP, so the deposit is never the smaller half', () => {
    expect(photographyDepositMinor(7001)).toBe(3501);
    expect(photographyDepositMinor(1)).toBe(0);
  });

  it('leaves a tour booking paid in full', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: tourOcc,
      party: { Adult: 1 },
      customerName: 'Tour Guest',
      customerEmail: 'tour@example.com',
      source: 'web',
      idempotencyKey: 'tour-full-0001',
    });
    const b = await booking(db, booked.ref);
    expect(b.deposit_minor).toBe(0);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_create_payment', { bookingRef: booked.ref, idempotencyKey: 'tour-pay-1' });
    expect((await payment(db, b.id, 'booking')).amount_minor).toBe(b.total_minor);
  });

  it('locks the trigger function to service_role', async () => {
    await db.asOwner();
    const { rows } = await db.pg.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.set_photography_deposit()', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'public.set_photography_deposit()', 'EXECUTE') as auth`,
    );
    expect(rows[0]).toEqual({ anon: false, auth: false });
  });
});
