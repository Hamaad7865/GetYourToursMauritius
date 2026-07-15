// Owner alerts ride the same drain: resolve the Telegram sentinel so all confirmation-time rows
// send here (the unconfigured fail-loud path is covered by booking-flow.test.ts).
process.env.TELEGRAM_OWNER_CHAT_ID = '-1002233445566';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { pgliteRpc } from '../db/rpc';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import type { NotificationMessage, NotificationProvider } from '@/lib/notifications/types';
import { drainNotifications } from '@/lib/services/notifications';

/**
 * Airport-transfer confirmation emails attach ONLY the tax receipt; the branded e-voucher is delivered as a
 * secure LINK to the auth-gated booking page (not attached) so heuristic mail-scanners have no voucher PDF
 * to false-positive on. This books a Zone-2 transfer, pays + confirms it, drains the outbox, and asserts the
 * captured message has exactly one `invoice-*.pdf` (a real `%PDF`), NO `voucher-*.pdf`, and an e-voucher
 * link to the booking page in the body.
 */
const CUSTOMER = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

class CapturingProvider implements NotificationProvider {
  readonly name = 'capture';
  messages: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<void> {
    this.messages.push(JSON.parse(JSON.stringify(message)) as NotificationMessage);
  }
}

const decodeHead = (b64: string, n: number): string => atob(b64).slice(0, n);

describe('transfer booking_confirmation drain → receipt attached, e-voucher linked', () => {
  let db: TestDb;
  let ctx: ServiceContext;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);

    // The seeded airport-transfer product lives in catch-up.sql, not the migrations the harness applies,
    // so create the same shape here (published, vehicle mode, is_airport_transfer + one price/occurrence).
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode, is_airport_transfer)
         values ($1, 'airport-transfer', 'transport', 'Airport Transfer', 'Airport transfers', 'published', 'vehicle', true)
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    const optId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Per transfer') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
       values ($1, 'Transfer', 3600, null)`,
      [optId],
    );
    const occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '2 days', now() + interval '2 days 1 hour', 40) returning id`,
        [optId, operatorId],
      )
    ).rows[0]!.id;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      expectedSlug: 'airport-transfer',
      party: { Transfer: 2 },
      dropoffSlug: 'shandrani-beachcomber',
      dropoffLocation: 'Shandrani Beachcomber Resort & Spa, Blue Bay',
      tripDirection: 'arrival',
      flightNumber: 'MK015',
      arrivalTime: '14:30',
      roomOrCabin: 'Room 214',
      luggageDetails: '3 large suitcases',
      childSeatAge: 3,
      travellerCountry: 'France',
      specialNotes: 'Please wait at gate B',
      customerName: 'Voucher Tester',
      customerEmail: 'voucher@example.com',
      source: 'web',
      idempotencyKey: 'voucher-book-12345678',
    });
    const payment = await call<{ paymentId: string; amountMinor: number }>(
      db,
      'api_create_payment',
      {
        bookingRef: booking.ref,
        idempotencyKey: 'voucher-pay-12345678',
      },
    );
    // Charge recording + webhook confirmation both run as the server — api_record_payment_charge is
    // service-role-only since 20260807000000.
    await db.as({ sub: 'service', role: 'service_role' });
    await call(db, 'api_record_payment_charge', {
      paymentId: payment.paymentId,
      chargedAmountMinor: 3850,
      chargedCurrency: 'USD',
    });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'paid', 'pe_voucher_1', $2::int, now(), '{}'::jsonb)`,
      [payment.paymentId, payment.amountMinor],
    );

    ctx = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date('2026-06-23T12:00:00Z'),
    };
  });

  afterAll(async () => {
    await db.close();
  });

  it('attaches only the tax receipt and links the e-voucher (no voucher PDF in the email)', async () => {
    const provider = new CapturingProvider();
    const result = await drainNotifications(ctx, provider);
    expect(result).toEqual({ processed: 3, sent: 3, failed: 0 });

    const msg = provider.messages.find((m) => m.template === 'booking_confirmation')!;
    expect(msg).toBeTruthy();

    // Exactly one attachment — the tax receipt. The e-voucher is NOT attached (mail-scanners have no
    // voucher PDF to false-positive on).
    expect(msg.attachments).toHaveLength(1);
    const inv = msg.attachments![0]!;
    expect(inv.filename).toMatch(/^invoice-.*\.pdf$/);
    expect(inv.contentType).toBe('application/pdf');
    expect(decodeHead(inv.content, 4)).toBe('%PDF');
    expect(msg.attachments!.some((a) => /voucher/.test(a.filename))).toBe(false);

    // The e-voucher reaches the customer as a secure link to the auth-gated booking page, in both bodies.
    const ref = String(msg.payload.ref);
    expect(msg.html).toContain(`/bookings/${ref}`);
    expect(msg.html).toContain('e-voucher');
    expect(msg.text).toContain(`/bookings/${ref}`);
  });
});
