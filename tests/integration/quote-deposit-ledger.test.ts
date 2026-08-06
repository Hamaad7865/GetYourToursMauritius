import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

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
});
