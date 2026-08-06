import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Deposit sizing at conversion + charge (Task 2 of the quote-deposit plan).
 *
 * A quote guest pays a DEPOSIT that confirms the booking; staff chase the balance later. The design
 * turns on two figures written at conversion and one row sized off them:
 *
 *   1. api_convert_quote writes deposit_minor = round(total_minor * deposit_bps / 10000) onto the
 *      booking, and INITIALISES balance_due_minor to the FULL total_minor — nothing is settled at
 *      conversion, so the "amount still owed" is the whole order. append_payment_event then recomputes
 *      it downwards as money lands (deposit settles → total - deposit; balance settles → 0), which is
 *      pinned in quote-deposit-ledger.test.ts. total_minor AND operator_payout_minor stay the FULL
 *      quoted price — they feed VAT and the operator payout, and must never be reduced to the deposit.
 *
 *   2. create_payment sizes the FIRST `booking` payments row to the booking's deposit_minor (read from
 *      the row, never caller input), so append_payment_event confirms the booking the moment that row
 *      is paid in full — the existing confirm-on-paid path, unchanged.
 *
 * A pay-in-full quote (deposit_bps = 10000) makes the deposit the whole total; nothing is settled at
 * conversion, so balance_due_minor still reads the full total until that deposit clears — the UNCHANGED
 * charge path, asserted here so the deposit path cannot regress it.
 */

interface CreatePaymentOut {
  paymentId: string;
  bookingRef: string;
  amountMinor: number;
}

interface BookingMoney {
  total_minor: number;
  operator_payout_minor: number;
  deposit_minor: number;
  balance_due_minor: number;
  status: string;
  payment_state: string;
}

describe('api_convert_quote sizes the deposit; create_payment charges it', () => {
  let db: TestDb;
  let seq = 0;

  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  /**
   * A sent quote with one custom line whose subtotal equals `totalMinor` (api_convert_quote's
   * quote_total_mismatch gate refuses any drift), converted through the real RPC. `depositBps`
   * defaults to the column default (1000 = 10%) when omitted.
   */
  async function convertQuote(totalMinor: number, depositBps?: number): Promise<{ ref: string }> {
    seq += 1;
    await db.asOwner();
    const { rows } =
      depositBps === undefined
        ? await db.pg.query<{ id: string }>(
            `insert into quotes (ref, customer_name, customer_email, status, valid_until, total_minor, sent_at)
             values ($1, 'Marie Dupont', $2, 'sent', current_date + 7, $3, now()) returning id`,
            [`QDEP${seq}`, `marie${seq}@example.com`, totalMinor],
          )
        : await db.pg.query<{ id: string }>(
            `insert into quotes (ref, customer_name, customer_email, status, valid_until, total_minor, deposit_bps, sent_at)
             values ($1, 'Marie Dupont', $2, 'sent', current_date + 7, $3, $4, now()) returning id`,
            [`QDEP${seq}`, `marie${seq}@example.com`, totalMinor, depositBps],
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

  async function bookingMoney(ref: string): Promise<BookingMoney> {
    await db.asOwner();
    const { rows } = await db.pg.query<BookingMoney>(
      `select total_minor, operator_payout_minor, deposit_minor, balance_due_minor, status::text as status,
              payment_state::text as payment_state
         from bookings where ref = $1`,
      [ref],
    );
    return rows[0]!;
  }

  async function bookingPaymentAmount(ref: string): Promise<number> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ amount_minor: number }>(
      `select p.amount_minor from payments p join bookings b on b.id = p.booking_id
        where b.ref = $1 and p.purpose = 'booking'`,
      [ref],
    );
    return Number(rows[0]!.amount_minor);
  }

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('a 10% deposit quote (EUR 1000) mints a booking owing the FULL total until the deposit settles', async () => {
    const { ref } = await convertQuote(100000, 1000);

    const money = await bookingMoney(ref);
    expect(money.deposit_minor).toBe(10000); // 100000 * 1000 / 10000 — sizes the first charge
    expect(money.balance_due_minor).toBe(100000); // nothing settled at conversion → the whole order is owed
    expect(money.total_minor).toBe(100000); // the FULL price — feeds VAT
    expect(money.operator_payout_minor).toBe(100000); // never reduced to the deposit

    // The minted checkout charges the DEPOSIT, not the full total — that is what lets the existing
    // confirm-on-paid path confirm the booking when the deposit clears.
    await db.as({ role: 'service_role' });
    const out = await call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: 'dep-10',
    });
    expect(out.amountMinor).toBe(10000);
    expect(await bookingPaymentAmount(ref)).toBe(10000);
  });

  it('the deposit defaults to 10% when the quote does not set deposit_bps', async () => {
    const { ref } = await convertQuote(100000);
    const money = await bookingMoney(ref);
    expect(money.deposit_minor).toBe(10000);
    expect(money.balance_due_minor).toBe(100000); // full total owed until the deposit clears
  });

  it('a pay-in-full quote (deposit_bps = 10000) charges the whole total; the balance clears when it settles', async () => {
    const { ref } = await convertQuote(100000, 10000);

    const money = await bookingMoney(ref);
    expect(money.deposit_minor).toBe(100000); // the whole total is the first (and only) charge
    expect(money.balance_due_minor).toBe(100000); // still owed at conversion — nothing has settled yet
    expect(money.total_minor).toBe(100000);

    await db.as({ role: 'service_role' });
    const out = await call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: 'dep-full',
    });
    expect(out.amountMinor).toBe(100000); // the unchanged full-charge path
    expect(await bookingPaymentAmount(ref)).toBe(100000);
  });

  it('rounds a fractional deposit to the minor unit; the full total is owed until it settles', async () => {
    // 12.5% of EUR 999.99 = 12499.875 minor → rounds to 12500 (the deposit CHARGE). balance_due_minor
    // is the whole total at conversion; the deposit/balance split (total - 12500) only materialises once
    // the deposit settles — asserted in quote-deposit-ledger.test.ts.
    const { ref } = await convertQuote(99999, 1250);
    const money = await bookingMoney(ref);
    expect(money.deposit_minor).toBe(12500);
    expect(money.balance_due_minor).toBe(99999); // full total owed at conversion (nothing settled)
    expect(money.balance_due_minor).toBe(money.total_minor);
  });
});
