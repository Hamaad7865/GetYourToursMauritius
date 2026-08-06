import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Schema guard for 20260912000000_quote_deposit.
 *
 * The deposit/balance feature turns on three storage facts, and the migration ledger + catch-up /
 * setup parity guards only prove the FILE is mirrored — they would stay green if a default were
 * wrong or the purpose check silently dropped. This asserts the invariants directly:
 *
 *  - `quotes.deposit_bps` is `int not null default 1000` (basis points; 1000 = 10.00%) with a
 *    `check (deposit_bps between 1 and 10000)`. The default is the product default (10% deposit);
 *    the range forbids a 0% deposit (would charge nothing and never confirm) and >100%.
 *  - `bookings.deposit_minor` and `bookings.balance_due_minor` are `bigint not null default 0`.
 *    The default is LOAD-BEARING: `balance_due_minor` is the "how much is still owed" source of
 *    truth, so an existing (pre-migration) booking must read 0 — "nothing owed" — not `total_minor`,
 *    which would make every legacy confirmed booking look part-paid to every reader and sweep.
 *  - `payments.purpose` now accepts `'balance'` (the balance is a second, purpose-scoped payments
 *    row, exactly like `pickup_addon`), while still refusing an unknown purpose.
 */

const MONEY_DEFAULT_ZERO: ReadonlyArray<[string, string]> = [
  ['bookings', 'deposit_minor'],
  ['bookings', 'balance_due_minor'],
];

describe('quote deposit schema (20260912000000)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('defaults quotes.deposit_bps to 1000 (a 10% deposit)', async () => {
    const { rows } = await db.pg.query<{ deposit_bps: number }>(
      `insert into quotes (ref, customer_name, customer_email, valid_until)
       values ('BMT-DEP1', 'Guest', 'dep1@example.com', current_date + 7)
       returning deposit_bps`,
    );
    expect(
      rows[0]!.deposit_bps,
      'a new quote must default to a 10% deposit (deposit_bps = 1000)',
    ).toBe(1000);
  });

  it('stores deposit_bps as a not-null integer', async () => {
    const { rows } = await db.pg.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'quotes' and column_name = 'deposit_bps'`,
    );
    expect(rows[0]?.data_type, 'quotes.deposit_bps is missing').toBeDefined();
    expect(rows[0]!.data_type).toBe('integer');
    expect(rows[0]!.is_nullable, 'deposit_bps must be NOT NULL so the default always applies').toBe(
      'NO',
    );
  });

  it('accepts the boundary deposits (1 = 0.01%, 10000 = pay in full)', async () => {
    await expect(
      db.pg.query(
        `insert into quotes (ref, customer_name, customer_email, valid_until, deposit_bps)
         values ('BMT-DEPMIN', 'Guest', 'depmin@example.com', current_date + 7, 1)`,
      ),
      'deposit_bps = 1 (the low boundary) was rejected',
    ).resolves.toBeTruthy();
    await expect(
      db.pg.query(
        `insert into quotes (ref, customer_name, customer_email, valid_until, deposit_bps)
         values ('BMT-DEPFULL', 'Guest', 'depfull@example.com', current_date + 7, 10000)`,
      ),
      'deposit_bps = 10000 (pay-in-full) was rejected',
    ).resolves.toBeTruthy();
  });

  it('rejects a 0% deposit and a deposit over 100%', async () => {
    await expect(
      db.pg.query(
        `insert into quotes (ref, customer_name, customer_email, valid_until, deposit_bps)
         values ('BMT-DEPZERO', 'Guest', 'depzero@example.com', current_date + 7, 0)`,
      ),
      'a 0% deposit (charges nothing, never confirms) was stored',
    ).rejects.toThrow(/quotes_deposit_bps_check/);
    await expect(
      db.pg.query(
        `insert into quotes (ref, customer_name, customer_email, valid_until, deposit_bps)
         values ('BMT-DEPOVER', 'Guest', 'depover@example.com', current_date + 7, 10001)`,
      ),
      'a deposit above 100% was stored',
    ).rejects.toThrow(/quotes_deposit_bps_check/);
  });

  it('defaults deposit_minor and balance_due_minor to 0 on an EXISTING booking (nothing owed)', async () => {
    // The landmine: defaulting balance_due_minor to total_minor would make every legacy booking look
    // part-paid. A booking inserted WITHOUT the new columns — as every reader/sweep created a
    // confirmed, fully-paid booking before this migration — must read 0 owed, not 50000.
    const { rows } = await db.pg.query<{ deposit_minor: string; balance_due_minor: string }>(
      `insert into bookings (customer_name, customer_email, status, total_minor)
       values ('Legacy Guest', 'legacy@example.com', 'confirmed', 50000)
       returning deposit_minor, balance_due_minor`,
    );
    expect(Number(rows[0]!.deposit_minor), 'deposit_minor did not default to 0').toBe(0);
    expect(
      Number(rows[0]!.balance_due_minor),
      'balance_due_minor defaulted to the full amount — every legacy booking now looks part-paid',
    ).toBe(0);
  });

  it('stores both deposit columns as bigint (the money-path width, not int)', async () => {
    for (const [table, column] of MONEY_DEFAULT_ZERO) {
      const { rows } = await db.pg.query<{ data_type: string }>(
        `select data_type from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name = $2`,
        [table, column],
      );
      expect(rows[0]?.data_type, `${table}.${column} is missing`).toBeDefined();
      expect(
        rows[0]!.data_type,
        `${table}.${column} is ${rows[0]?.data_type}; int caps at ~21.4M EUR-cents and a full-boat charter overflows it`,
      ).toBe('bigint');
    }
  });

  it("accepts 'balance' as a payments purpose, still refusing an unknown one", async () => {
    const { rows: booking } = await db.pg.query<{ id: string }>(
      `insert into bookings (customer_name, customer_email, status, total_minor)
       values ('Balance Guest', 'balance@example.com', 'confirmed', 100000) returning id`,
    );
    const bookingId = booking[0]!.id;

    await expect(
      db.pg.query(
        `insert into payments (booking_id, idempotency_key, amount_minor, purpose)
         values ($1, 'balance:test:1', 90000, 'balance')`,
        [bookingId],
      ),
      "'balance' is not an accepted payments.purpose — the balance row cannot be minted",
    ).resolves.toBeTruthy();

    await expect(
      db.pg.query(
        `insert into payments (booking_id, idempotency_key, amount_minor, purpose)
         values ($1, 'bogus:test:1', 90000, 'nonsense')`,
        [bookingId],
      ),
      'the purpose check was widened into an anything-goes column',
    ).rejects.toThrow(/payments_purpose_check/);
  });
});
