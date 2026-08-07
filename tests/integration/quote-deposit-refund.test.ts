import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * THE NON-REFUNDABLE QUOTE DEPOSIT (Task 7 of the quote-deposit plan, deferred out of the
 * invoice-split ship because the naive version is unsafe — see the migration header and
 * [[gytm-deposit-invoice-split]]).
 *
 * A genuine PARTIAL deposit (0 < deposit_minor < total_minor) is money the guest agreed is forfeit on
 * cancellation. api_mark_refunded must therefore:
 *   (a) KEEP the deposit row (never reverse it) but still drive the booking to a TERMINAL state — the
 *       deposit row keeps the payment_state roll-up at 'paid', so append_payment_event can never move
 *       the booking off refund_pending on its own (the naive-fix "stuck queue" bug);
 *   (b) leave balance_due_minor unable to make the booking payable again — refunding the balance row
 *       rebounds balance_due_minor 0 → balance, which on a still-'confirmed' booking would re-arm the
 *       durable balance link for a SECOND charge (the naive-fix "double charge" bug);
 *   (c) invalidate the durable balance link (quotes.balance_token_hash + the status gate);
 *   (d) send the guest a FORFEIT notice ('deposit_forfeited'), NOT booking_refunded ("fully refunded").
 *
 * A pay-in-full quote (deposit_minor = total_minor) and every ordinary booking are NOT partial deposits
 * and stay fully refundable, exactly as before.
 */

const STAFF = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

interface CreatePaymentOut {
  paymentId: string;
  amountMinor: number;
}
interface PaymentRow {
  purpose: string;
  status: string;
  paid_minor: number | string;
  refunded_minor: number | string;
}

describe('quote deposit — non-refundable deposit on refund', () => {
  let db: TestDb;
  let seq = 0;

  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  /** Convert a quote at the given deposit size and return the minted booking ref. */
  async function convertQuote(totalMinor: number, depositBps: number): Promise<{ ref: string }> {
    seq += 1;
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, status, valid_until, total_minor, deposit_bps, sent_at)
       values ($1, 'Marie Dupont', $2, 'sent', current_date + 7, $3, $4, now()) returning id`,
      [`QREF${seq}`, `ref${seq}@example.com`, totalMinor, depositBps],
    );
    const quoteId = rows[0]!.id;
    await db.pg.query(
      `insert into quote_items (quote_id, position, kind, description, starts_at, quantity, unit_amount_minor, subtotal_minor)
       values ($1, 1, 'custom', 'Private guide, full day', now() + interval '10 days', 1, $2, $2)`,
      [quoteId, totalMinor],
    );
    await db.as({ role: 'service_role' });
    return call<{ ref: string }>('api_convert_quote', { quoteId });
  }

  async function mint(ref: string, key: string, purpose?: 'balance'): Promise<CreatePaymentOut> {
    await db.as({ role: 'service_role' });
    return call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: key,
      ...(purpose ? { purpose } : {}),
    });
  }

  async function settle(paymentId: string, eventId: string, amountMinor: number): Promise<void> {
    await db.as({ role: 'service_role' });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'paid', $2::text, $3::bigint, now(), '{}'::jsonb)`,
      [paymentId, eventId, amountMinor],
    );
  }

  async function bookingId(ref: string): Promise<string> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [
      ref,
    ]);
    return rows[0]!.id;
  }

  /** Move the confirmed booking to refund_pending as the owner (the pre-refund state) and arm a
   *  durable balance link, so we can prove mark_refunded tears it down. The quote's ref differs from the
   *  minted booking's ref, so the quote is reached by booking_id, not by ref. */
  async function makeRefundPendingWithBalanceLink(ref: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'refund_pending' where ref = $1`, [ref]);
    const { affectedRows } = await db.pg.query(
      `update quotes set balance_token_hash = repeat('a', 64)
         where booking_id = (select id from bookings where ref = $1)`,
      [ref],
    );
    expect(affectedRows, 'the balance link was not armed — no quote points at this booking').toBe(
      1,
    );
  }

  async function markRefunded(id: string): Promise<void> {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`select api_mark_refunded($1::jsonb)`, [JSON.stringify({ bookingId: id })]);
    await db.asOwner();
  }

  async function statusOf(ref: string): Promise<string> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ status: string }>(
      `select status from bookings where ref = $1`,
      [ref],
    );
    return rows[0]!.status;
  }

  async function payments(ref: string): Promise<PaymentRow[]> {
    await db.asOwner();
    const { rows } = await db.pg.query<PaymentRow>(
      `select pay.purpose, pay.status, pay.paid_minor, pay.refunded_minor
         from payments pay join bookings b on b.id = pay.booking_id
        where b.ref = $1 order by pay.created_at`,
      [ref],
    );
    return rows;
  }

  async function guestTemplates(ref: string): Promise<string[]> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ template: string }>(
      `select o.template from notification_outbox o join bookings b on b.id = o.booking_id
        where b.ref = $1 and o.channel = 'email' and o.recipient <> 'owner'
        order by o.created_at`,
      [ref],
    );
    return rows.map((r) => r.template);
  }

  async function balanceTokenHash(ref: string): Promise<string | null> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ h: string | null }>(
      `select q.balance_token_hash as h from quotes q
         join bookings b on b.id = q.booking_id where b.ref = $1`,
      [ref],
    );
    return rows[0]!.h;
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff')`, [STAFF]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('deposit-only: keeps the deposit, drives the booking terminal, forfeits, kills the balance link', async () => {
    const { ref } = await convertQuote(100000, 1000); // EUR 1000, 10% deposit
    const dep = await mint(ref, 'ref-only-dep');
    expect(dep.amountMinor).toBe(10000);
    await settle(dep.paymentId, 'evt-only-dep', 10000); // confirms, balance never taken
    await makeRefundPendingWithBalanceLink(ref);

    const id = await bookingId(ref);
    await markRefunded(id);

    // (a) terminal — not stuck in refund_pending forever (the naive-fix stuck-queue bug)
    expect(await statusOf(ref)).toBe('cancelled');

    // deposit KEPT — the sole 'booking' row is never reversed
    const rows = await payments(ref);
    const deposit = rows.find((r) => r.purpose === 'booking')!;
    expect(deposit.status).toBe('paid');
    expect(Number(deposit.refunded_minor)).toBe(0);

    // (c) the durable balance link is dead — credential cleared AND status gate closed
    expect(await balanceTokenHash(ref)).toBeNull();

    // (b) not payable: the balance checkout is refused on the terminal booking
    await db.as({ role: 'service_role' });
    await expect(
      call('api_create_quote_payment', {
        bookingRef: ref,
        idempotencyKey: 'ref-only-reopen',
        purpose: 'balance',
      }),
    ).rejects.toThrow(/booking_not_payable/);

    // (d) the guest gets a FORFEIT notice, never the "fully refunded" email
    const templates = await guestTemplates(ref);
    expect(templates).toContain('deposit_forfeited');
    expect(templates).not.toContain('booking_refunded');
  });

  it('both paid: refunds the balance, keeps the deposit, drives terminal, forfeits, kills the link', async () => {
    const { ref } = await convertQuote(100000, 1000);
    const dep = await mint(ref, 'ref-both-dep');
    await settle(dep.paymentId, 'evt-both-dep', 10000);
    const bal = await mint(ref, 'ref-both-bal', 'balance');
    expect(bal.amountMinor).toBe(90000);
    await settle(bal.paymentId, 'evt-both-bal', 90000); // fully paid, balance_due_minor = 0
    await makeRefundPendingWithBalanceLink(ref);

    const id = await bookingId(ref);
    await markRefunded(id);

    expect(await statusOf(ref)).toBe('cancelled');

    const rows = await payments(ref);
    const deposit = rows.find((r) => r.purpose === 'booking')!;
    const balance = rows.find((r) => r.purpose === 'balance')!;
    // deposit KEPT, balance REFUNDED
    expect(deposit.status).toBe('paid');
    expect(Number(deposit.refunded_minor)).toBe(0);
    expect(balance.status).toBe('refunded');
    expect(Number(balance.refunded_minor)).toBe(90000);

    // the balance refund rebounds balance_due_minor 0 → balance, but the link is dead both ways
    expect(await balanceTokenHash(ref)).toBeNull();
    await db.as({ role: 'service_role' });
    await expect(
      call('api_create_quote_payment', {
        bookingRef: ref,
        idempotencyKey: 'ref-both-reopen',
        purpose: 'balance',
      }),
    ).rejects.toThrow(/booking_not_payable/);

    const templates = await guestTemplates(ref);
    expect(templates).toContain('deposit_forfeited');
    expect(templates).not.toContain('booking_refunded');
  });

  it('is idempotent — a second mark_refunded is a no-op with no second forfeit email', async () => {
    const { ref } = await convertQuote(100000, 1000);
    const dep = await mint(ref, 'ref-idem-dep');
    await settle(dep.paymentId, 'evt-idem-dep', 10000);
    await makeRefundPendingWithBalanceLink(ref);

    const id = await bookingId(ref);
    await markRefunded(id);
    await markRefunded(id); // repeat click

    expect(await statusOf(ref)).toBe('cancelled');
    const templates = await guestTemplates(ref);
    expect(templates.filter((t) => t === 'deposit_forfeited')).toHaveLength(1);
  });

  it('a pay-in-full quote (deposit == total) stays FULLY refundable', async () => {
    const { ref } = await convertQuote(100000, 10000); // 100% deposit
    const dep = await mint(ref, 'ref-full-dep');
    expect(dep.amountMinor).toBe(100000);
    await settle(dep.paymentId, 'evt-full-dep', 100000);
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'refund_pending' where ref = $1`, [ref]);

    const id = await bookingId(ref);
    await markRefunded(id);

    // Not a partial deposit → the ordinary refund path: fully reversed, terminal 'refunded', and the
    // ordinary booking_refunded email — NOT the forfeit notice.
    expect(await statusOf(ref)).toBe('refunded');
    const rows = await payments(ref);
    const deposit = rows.find((r) => r.purpose === 'booking')!;
    expect(deposit.status).toBe('refunded');
    expect(Number(deposit.refunded_minor)).toBe(100000);

    const templates = await guestTemplates(ref);
    expect(templates).toContain('booking_refunded');
    expect(templates).not.toContain('deposit_forfeited');
  });
});
