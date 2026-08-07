import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * The RECEIPT-vs-INVOICE split (Task 6 + 7 of the quote-deposit plan).
 *
 *   1. A deposit-confirmed booking (balance still owed) emails a DEPOSIT RECEIPT, never the full VAT
 *      invoice — enqueue_booking_notification forks the guest email on new.balance_due_minor.
 *   2. The full 'booking_confirmation' invoice fires when the BALANCE clears (a booking-status no-op),
 *      from the notify_balance_paid payments-status trigger, exactly once — plus an EMAIL-ONLY owner
 *      alert (Telegram/WhatsApp would throw in prod).
 *   3. A pay-in-full quote (deposit_bps = 10000) emails the full invoice immediately, unchanged.
 *   4. api_booking_receipt exposes balance_due_minor and SUMS the settled charge across the deposit
 *      ('booking') and balance ('balance') rows.
 *   5. api_mark_refunded does NOT reverse a genuine partial-deposit row, but a pay-in-full quote's
 *      'booking' row (deposit == total) stays fully refundable.
 */

interface OutboxRow {
  template: string;
  channel: string;
  recipient: string;
}
interface CreatePaymentOut {
  paymentId: string;
  amountMinor: number;
}

describe('quote deposit — receipt vs full invoice split', () => {
  let db: TestDb;
  let seq = 0;

  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  async function convertQuote(totalMinor: number, depositBps: number): Promise<{ ref: string }> {
    seq += 1;
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, status, valid_until, total_minor, deposit_bps, sent_at)
       values ($1, 'Marie Dupont', $2, 'sent', current_date + 7, $3, $4, now()) returning id`,
      [`QINV${seq}`, `inv${seq}@example.com`, totalMinor, depositBps],
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

  async function guestOutbox(ref: string): Promise<OutboxRow[]> {
    await db.asOwner();
    const { rows } = await db.pg.query<OutboxRow>(
      `select o.template, o.channel, o.recipient
         from notification_outbox o join bookings b on b.id = o.booking_id
        where b.ref = $1 and o.channel = 'email' and o.recipient <> 'owner'
        order by o.created_at`,
      [ref],
    );
    return rows;
  }

  async function ownerOutbox(ref: string, template: string): Promise<OutboxRow[]> {
    await db.asOwner();
    const { rows } = await db.pg.query<OutboxRow>(
      `select o.template, o.channel, o.recipient
         from notification_outbox o join bookings b on b.id = o.booking_id
        where b.ref = $1 and o.recipient = 'owner' and o.template = $2`,
      [ref, template],
    );
    return rows;
  }

  async function bookingId(ref: string): Promise<string> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [
      ref,
    ]);
    return rows[0]!.id;
  }

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('a deposit settling emails a deposit_receipt, NOT the full booking_confirmation', async () => {
    const { ref } = await convertQuote(100000, 1000); // EUR 1000, 10% deposit
    const dep = await mint(ref, 'inv-dep1');
    expect(dep.amountMinor).toBe(10000); // charges the deposit, not the total
    await settle(dep.paymentId, 'paid', 'evt-inv-dep1', 10000);

    const templates = (await guestOutbox(ref)).map((r) => r.template);
    expect(templates).toContain('deposit_receipt');
    expect(templates).not.toContain('booking_confirmation');
  });

  it('the balance clearing fires the full invoice ONCE + an email-only owner alert', async () => {
    const { ref } = await convertQuote(100000, 1000);
    const dep = await mint(ref, 'inv-dep2');
    await settle(dep.paymentId, 'paid', 'evt-inv-dep2', 10000);

    const bal = await mint(ref, 'inv-bal2', 'balance');
    expect(bal.amountMinor).toBe(90000); // the remaining balance
    await settle(bal.paymentId, 'paid', 'evt-inv-bal2', 90000);

    const guest = await guestOutbox(ref);
    expect(guest.filter((r) => r.template === 'deposit_receipt')).toHaveLength(1);
    expect(guest.filter((r) => r.template === 'booking_confirmation')).toHaveLength(1);

    const ownerAlerts = await ownerOutbox(ref, 'owner_balance_paid');
    expect(ownerAlerts).toHaveLength(1);
    // EMAIL ONLY: a telegram/whatsapp owner row would park a permanently-failing outbox entry in prod.
    expect(ownerAlerts.every((r) => r.channel === 'email')).toBe(true);
  });

  it('a re-settled balance does NOT double the full invoice (booking-scoped idempotency)', async () => {
    const { ref } = await convertQuote(100000, 1000);
    const dep = await mint(ref, 'inv-dep2b');
    await settle(dep.paymentId, 'paid', 'evt-inv-dep2b', 10000);
    const bal = await mint(ref, 'inv-bal2b', 'balance');
    await settle(bal.paymentId, 'paid', 'evt-inv-bal2b', 90000);
    // A second 'paid' event on the same balance row (a webhook replay) must not fire a second invoice.
    await settle(bal.paymentId, 'paid', 'evt-inv-bal2b-again', 0);

    const guest = await guestOutbox(ref);
    expect(guest.filter((r) => r.template === 'booking_confirmation')).toHaveLength(1);
  });

  it('a pay-in-full quote emails the full booking_confirmation immediately, no deposit_receipt', async () => {
    const { ref } = await convertQuote(100000, 10000); // 100% deposit = pay in full
    const dep = await mint(ref, 'inv-full');
    expect(dep.amountMinor).toBe(100000);
    await settle(dep.paymentId, 'paid', 'evt-inv-full', 100000);

    const templates = (await guestOutbox(ref)).map((r) => r.template);
    expect(templates).toContain('booking_confirmation');
    expect(templates).not.toContain('deposit_receipt');
  });

  it('api_booking_receipt exposes balance_due_minor and sums the charge across booking+balance', async () => {
    const { ref } = await convertQuote(100000, 1000);
    const dep = await mint(ref, 'inv-rcpt-dep');
    await settle(dep.paymentId, 'paid', 'evt-inv-rcpt-dep', 10000);
    const id = await bookingId(ref);

    await db.as({ role: 'service_role' });
    const r1 = await call<{ balanceDueMinor: number; payment: { chargedAmountMinor: number } }>(
      'api_booking_receipt',
      { bookingId: id },
    );
    expect(Number(r1.balanceDueMinor)).toBe(90000); // the balance is exposed to the receipt renderer

    // The charged figure is the SUM over settled booking+balance rows; only the deposit has settled so
    // far, so it equals the deposit row's own charge.
    await db.asOwner();
    const { rows: depRow } = await db.pg.query<{ c: number }>(
      `select coalesce(charged_amount_minor, amount_minor) as c from payments
        where booking_id = $1 and purpose = 'booking'`,
      [id],
    );
    expect(Number(r1.payment.chargedAmountMinor)).toBe(Number(depRow[0]!.c));

    // Clear the balance → settled = full, balance 0, and the charge sums BOTH rows.
    const bal = await mint(ref, 'inv-rcpt-bal', 'balance');
    await settle(bal.paymentId, 'paid', 'evt-inv-rcpt-bal', 90000);
    await db.as({ role: 'service_role' });
    const r2 = await call<{ balanceDueMinor: number; payment: { chargedAmountMinor: number } }>(
      'api_booking_receipt',
      { bookingId: id },
    );
    expect(Number(r2.balanceDueMinor)).toBe(0);
    await db.asOwner();
    const { rows: both } = await db.pg.query<{ c: number }>(
      `select coalesce(sum(coalesce(charged_amount_minor, amount_minor)), 0) as c from payments
        where booking_id = $1 and purpose in ('booking', 'balance') and paid_minor > 0`,
      [id],
    );
    expect(Number(r2.payment.chargedAmountMinor)).toBe(Number(both[0]!.c));
  });

  it('a balance completing on a booking that has LEFT confirmed does not mail a settled-in-full invoice', async () => {
    const { ref } = await convertQuote(100000, 1000);
    const dep = await mint(ref, 'inv-gate-dep');
    await settle(dep.paymentId, 'paid', 'evt-inv-gate-dep', 10000);
    const bal = await mint(ref, 'inv-gate-bal', 'balance');

    // The booking leaves 'confirmed' (e.g. self-cancelled to refund_pending) before a still-live Peach
    // balance session lands. notify_balance_paid must NOT enqueue a paid-in-full invoice for money that
    // is being refunded — append_payment_event's own routing sends that capture to refund_pending.
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'refund_pending' where ref = $1`, [ref]);
    await settle(bal.paymentId, 'paid', 'evt-inv-gate-bal', 90000);

    const guest = await guestOutbox(ref);
    expect(guest.filter((r) => r.template === 'booking_confirmation')).toHaveLength(0);
    expect(await ownerOutbox(ref, 'owner_balance_paid')).toHaveLength(0);
  });
});
