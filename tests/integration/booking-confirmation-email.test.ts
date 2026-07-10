// Owner alerts ride the same drain: resolve the WhatsApp sentinel so all confirmation-time rows
// send here (the unconfigured fail-loud path is covered by booking-flow.test.ts).
process.env.OWNER_WHATSAPP_TO = '23057729919';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import type { NotificationMessage, NotificationProvider } from '@/lib/notifications/types';
import { drainNotifications } from '@/lib/services/notifications';

// Mock the PDF renderer so the failure case can force a throw, while the happy path delegates to the
// REAL renderer (importOriginal) — proving the end-to-end PDF render + attach + %PDF magic.
const pdfState = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/invoice/pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/invoice/pdf')>();
  return {
    ...actual,
    renderInvoicePdf: async (model: Parameters<typeof actual.renderInvoicePdf>[0]) => {
      if (pdfState.fail) throw new Error('pdf boom');
      return actual.renderInvoicePdf(model);
    },
  };
});

/**
 * Full invoice/receipt path through the drain: a paid + confirmed booking enqueues a
 * `booking_confirmation`; the drain loads the booking (api_booking_receipt), builds the invoice model,
 * renders the branded HTML email + the PDF, and hands the provider a fully pre-rendered message with the
 * invoice/receipt PDF attached. A PDF-render failure must NOT block the email — it sends HTML-only.
 */
const CUSTOMER = 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

/** A provider that captures the last message it was asked to send (never throws). */
class CapturingProvider implements NotificationProvider {
  readonly name = 'capture';
  messages: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<void> {
    // Capture a snapshot so later mutation can't change what we assert on.
    this.messages.push(JSON.parse(JSON.stringify(message)) as NotificationMessage);
  }
}

function decodeBase64Head(b64: string, n: number): string {
  // atob is available in the test (jsdom/node) environment; decode just the first n bytes for %PDF.
  return atob(b64).slice(0, n);
}

describe('booking_confirmation drain → invoice + receipt email', () => {
  let db: TestDb;
  let ctx: ServiceContext;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`);
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);

    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pickup_available)
         values ($1, 'receipt-tour', 'activity', 'Catamaran Cruise to Île aux Cerfs', 'Catamaran cruises', 'published', true)
         returning id`,
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
    const occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '2 days', now() + interval '2 days 4 hours', 20) returning id`,
        [optId, operatorId],
      )
    ).rows[0]!.id;

    // Book (2 adults + child seats + a pickup) as the customer, then pay + confirm via the webhook.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { Adult: 2 },
      childSeats: 2, // first free + 1 extra @ €6
      pickupLocation: 'Le Touessrok Resort',
      customerName: 'Jean Dupont',
      customerEmail: 'jean@example.com',
      source: 'web',
      idempotencyKey: 'receipt-book-12345678',
    });
    const payment = await call<{ paymentId: string; amountMinor: number }>(db, 'api_create_payment', {
      bookingRef: booking.ref,
      idempotencyKey: 'receipt-pay-12345678',
    });
    // Record the real (USD) card charge, as createPaymentLink does in production.
    await call(db, 'api_record_payment_charge', {
      paymentId: payment.paymentId,
      chargedAmountMinor: 16800,
      chargedCurrency: 'USD',
    });
    // The verified webhook (service-role) confirms the booking → enqueues the confirmation.
    await db.as({ sub: 'service', role: 'service_role' });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'paid', 'pe_receipt_1', $2::int, now(), '{}'::jsonb)`,
      [payment.paymentId, payment.amountMinor],
    );

    ctx = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date('2026-06-20T12:00:00Z'),
    };
  });

  afterEach(() => {
    pdfState.fail = false;
  });

  afterAll(async () => {
    await db.close();
  });

  it('sends a pre-rendered HTML email with the invoice/receipt PDF attached', async () => {
    const provider = new CapturingProvider();
    const result = await drainNotifications(ctx, provider);
    expect(result).toEqual({ processed: 3, sent: 3, failed: 0 });

    const msg = provider.messages.find((m) => m.template === 'booking_confirmation')!;
    expect(msg).toBeTruthy();

    // HTML body carries the booking ref + the EUR total (2×€70 + €6 child seat = €146).
    expect(msg.html).toBeTruthy();
    expect(msg.html).toContain(msg.payload.ref as string);
    expect(msg.html).toContain('EUR 146.00');
    expect(msg.subject).toContain(msg.payload.ref as string);

    // Exactly one PDF attachment whose decoded bytes start with the %PDF magic.
    expect(msg.attachments).toHaveLength(1);
    const att = msg.attachments![0]!;
    expect(att.contentType).toBe('application/pdf');
    expect(att.filename).toMatch(/^invoice-.*\.pdf$/);
    expect(decodeBase64Head(att.content, 4)).toBe('%PDF');

    // The row is marked sent.
    const row = (
      await db.pg.query<{ status: string }>(
        `select status from notification_outbox where template = 'booking_confirmation'`,
      )
    ).rows[0]!;
    expect(row.status).toBe('sent');
  });

  it('still sends the HTML email (no attachment) when the PDF render throws — and marks it sent', async () => {
    // Re-enqueue by resetting the existing confirmation row to pending (the trigger only fires on a
    // status change, so we reset the outbox directly).
    await db.asOwner();
    await db.pg.query(
      `update notification_outbox set status = 'pending', attempts = 0, sent_at = null, locked_until = null
       where template = 'booking_confirmation'`,
    );

    pdfState.fail = true;

    const provider = new CapturingProvider();
    const result = await drainNotifications(ctx, provider);
    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });

    const msg = provider.messages[0]!;
    expect(msg.html).toBeTruthy(); // the email still has its HTML body
    expect(msg.html).toContain('EUR 146.00');
    expect(msg.attachments ?? []).toHaveLength(0); // …but no PDF attachment

    const row = (
      await db.pg.query<{ status: string }>(
        `select status from notification_outbox where template = 'booking_confirmation'`,
      )
    ).rows[0]!;
    expect(row.status).toBe('sent'); // a PDF failure does NOT fail the send
  });
});
