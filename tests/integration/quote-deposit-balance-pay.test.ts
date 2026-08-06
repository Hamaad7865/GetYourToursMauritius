import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Balance payments row + accountless entry point (Task 4 of the quote-deposit plan).
 *
 * The deposit confirms the booking; the balance is chased later. It CANNOT be a second `booking` row
 * (create_payment's booking-payability guard refuses purpose='booking' on a confirmed booking, and two
 * `booking` rows would collide on the `order by created_at desc limit 1` lookup) — so, exactly like the
 * late-pickup add-on, the balance is a SEPARATE purpose='balance' payments row with its own payability
 * branch, its own single-flight lease and its own provider_checkout_id.
 *
 *   1. On a deposit-confirmed booking that still owes money, create_payment mints a 'balance' row sized
 *      to the booking's CURRENT balance_due_minor — a server figure, never caller input.
 *   2. Charging that row drives balance_due_minor to 0 (append_payment_event's projection, Task 3).
 *   3. A fully-paid booking (balance_due_minor = 0) refuses with a readable code — nothing is owed.
 *   4. A second mint returns the SAME payable session under the shared lease — never a second Peach one.
 *   5. The quote guest has NO account: authorization is the emailed link token, so the entry point stays
 *      service-role only (anon and a signed-in non-owner cannot reach it) and api_create_quote_payment is
 *      widened to admit 'balance' on a source='quote' booking alongside the deposit.
 */

const BOB = 'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7';

interface CreatePaymentOut {
  paymentId: string;
  bookingRef: string;
  amountMinor: number;
  existingCheckoutId: string | null;
  checkoutPending?: boolean | null;
}

describe('the balance is its own payments row, mintable by the accountless quote guest', () => {
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
      [`QBAL${seq}`, `bal${seq}@example.com`, totalMinor, depositBps],
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

  /** The quote guest's own entry point — the pay route calls this after verifying the link token. */
  async function mint(
    ref: string,
    purpose: 'booking' | 'balance',
    key: string,
  ): Promise<CreatePaymentOut> {
    await db.as({ role: 'service_role' });
    return call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: key,
      purpose,
    });
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

  /** Convert, mint the deposit and settle it — a real deposit-confirmed booking. */
  async function depositConfirmed(
    totalMinor: number,
    depositBps: number,
  ): Promise<{ ref: string }> {
    const { ref } = await convertQuote(totalMinor, depositBps);
    const dep = await mint(ref, 'booking', `${ref}-dep`);
    await settle(dep.paymentId, 'paid', `${ref}-dep-evt`, dep.amountMinor);
    return { ref };
  }

  async function bookingState(ref: string): Promise<{ status: string; balanceDueMinor: number }> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ status: string; balance_due_minor: number }>(
      `select status::text as status, balance_due_minor from bookings where ref = $1`,
      [ref],
    );
    return { status: rows[0]!.status, balanceDueMinor: Number(rows[0]!.balance_due_minor) };
  }

  /** Count + amount of the 'balance' payments rows on this booking, read as the owner. */
  async function balanceRows(ref: string): Promise<{ count: number; amount: number | null }> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ n: number; amount: string | null }>(
      `select count(*)::int as n, max(p.amount_minor) as amount
         from payments p join bookings b on b.id = p.booking_id
        where b.ref = $1 and p.purpose = 'balance'`,
      [ref],
    );
    return { count: rows[0]!.n, amount: rows[0]!.amount === null ? null : Number(rows[0]!.amount) };
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [BOB]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [BOB]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('mints a purpose=balance row sized to the amount still owed on a deposit-confirmed booking', async () => {
    const { ref } = await depositConfirmed(100000, 1000); // EUR 1000, 10% deposit
    expect(await bookingState(ref)).toMatchObject({ status: 'confirmed', balanceDueMinor: 90000 });

    const bal = await mint(ref, 'balance', `${ref}-bal`);
    // total_minor - deposit_minor == the booking's CURRENT balance_due_minor (the add-on-immune owed).
    expect(bal.amountMinor).toBe(90000);
    expect(bal.existingCheckoutId).toBeNull();

    const rows = await balanceRows(ref);
    expect(rows.count).toBe(1); // one 'balance' row, distinct from the deposit's 'booking' row
    expect(rows.amount).toBe(90000);
  });

  it('charging the balance drives balance_due_minor to 0', async () => {
    const { ref } = await depositConfirmed(100000, 1000);
    const bal = await mint(ref, 'balance', `${ref}-bal`);
    await settle(bal.paymentId, 'paid', `${ref}-bal-evt`, bal.amountMinor);

    // deposit + balance now cover the full total; the booking stays confirmed (a status no-op).
    expect(await bookingState(ref)).toMatchObject({ status: 'confirmed', balanceDueMinor: 0 });
  });

  it('a fully-paid booking refuses the balance — nothing owed', async () => {
    // A pay-in-full quote (deposit_bps = 10000): the deposit IS the whole total, so balance_due_minor
    // reaches 0 the moment it settles. There is nothing to collect, so no balance row may be opened.
    const { ref } = await depositConfirmed(100000, 10000);
    expect(await bookingState(ref)).toMatchObject({ status: 'confirmed', balanceDueMinor: 0 });

    await db.as({ role: 'service_role' });
    await expect(
      call('api_create_quote_payment', {
        bookingRef: ref,
        idempotencyKey: `${ref}-nobal`,
        purpose: 'balance',
      }),
    ).rejects.toThrow(/balance_already_paid/);
    expect((await balanceRows(ref)).count).toBe(0); // the refusal minted nothing
  });

  it('two balance mints yield ONE payable session, never two', async () => {
    const { ref } = await depositConfirmed(100000, 1000);

    // Two tabs, or a double-click. The winner holds the single-flight lease on the one balance row; the
    // loser is told to wait rather than being sent to Peach for a second, independently payable session.
    const first = await mint(ref, 'balance', `${ref}-bal-a`);
    const second = await mint(ref, 'balance', `${ref}-bal-b`);

    expect(first.checkoutPending ?? null).toBeNull();
    expect(second.paymentId).toBe(first.paymentId); // the same balance row…
    expect(second.checkoutPending).toBe(true); // …the same lease — no fork
    expect((await balanceRows(ref)).count).toBe(1);
  });

  it('anon and a signed-in non-owner cannot open a balance checkout — service_role only', async () => {
    // Authorization for a quote is the emailed LINK TOKEN, verified in the route before SQL. That is only
    // sound while nothing reachable from a browser can call the entry point directly, for the balance
    // exactly as for the deposit — `revoke from public` alone would leave Supabase's stock direct grants.
    const { ref } = await depositConfirmed(100000, 1000);

    await db.as(null);
    await expect(
      call('api_create_quote_payment', {
        bookingRef: ref,
        idempotencyKey: 'anon-bal',
        purpose: 'balance',
      }),
    ).rejects.toThrow(/permission denied/);

    await db.as({ sub: BOB, role: 'authenticated' });
    await expect(
      call('api_create_quote_payment', {
        bookingRef: ref,
        idempotencyKey: 'bob-bal',
        purpose: 'balance',
      }),
    ).rejects.toThrow(/permission denied/);

    expect((await balanceRows(ref)).count).toBe(0); // neither caller minted a row
  });
});
