import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteServiceRoleRpc } from '../db/rpc';
import { seedOccurrence } from '../db/seed';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { loadBookingForReceipt } from '@/lib/services/receipt';
import { buildInvoice } from '@/lib/invoice/model';
import { INVOICE_BUSINESS } from '@/lib/invoice/business';

/**
 * The VAT invoice a QUOTE booking gets — end to end, from api_convert_quote to the arithmetic on the
 * document.
 *
 * A quote booking's lines live in `booking_custom_items` and NOWHERE else: api_convert_quote refuses
 * a catalogue line outright, so by construction such a booking has zero `booking_items`. Until
 * 20260909000000 taught api_booking_receipt about that table, the receipt DTO arrived at buildInvoice
 * with `items: []` — and buildInvoice backs the 15% out of the gross PER LINE, so the invoice came
 * out claiming that the WHOLE charge was VAT, with nothing itemised beneath it:
 *
 *     subtotalNetEur = 0                                  (no lines to sum)
 *     vatAmountEur   = round2(totalGrossEur - 0)          = the entire order total
 *
 * That is a legally wrong tax document mailed to a guest, so the assertions below are about the
 * arithmetic ON the document, not about the shape of an RPC's JSON.
 *
 * MEASURED AGAINST THE UNPATCHED SCHEMA. This file used to slice api_booking_receipt out of
 * 20260909000000_quotes.sql and re-apply it in `beforeAll`, because the later
 * 20260910000000_late_pickup_addon.sql re-defined the function from a body predating the
 * `booking_custom_items` union and — "the LAST migration to define a function wins" — silently won.
 * That pin made this suite green while the live bug stood. It is gone: 20260910000000 now carries the
 * union itself, so what follows exercises the migration directory exactly as a real database builds
 * it. Never re-introduce a definition here; a test that patches the schema it is testing measures
 * nothing. tests/integration/resolved-function-bodies.test.ts guards the ordering itself.
 */

/** Mauritius VAT, applied INCLUSIVELY — the invoice backs it out of the gross, never adds it on. */
const VAT_RATE_PCT = 15;

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

describe('a converted quote is invoiced with its lines', () => {
  let db: TestDb;
  let ctx: ServiceContext;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    ctx = {
      db: pgliteServiceRoleRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date('2026-08-06T12:00:00Z'),
      locale: 'en',
    };
  });

  afterAll(async () => {
    await db.close();
  });

  /**
   * A staff-drafted quote with free-text lines, converted exactly as the guest's pay route converts
   * it. `total_minor` is the sum of the lines because api_convert_quote refuses to mint on any drift
   * (`quote_total_mismatch`), which is what makes the invoice's lines reconcile to its total.
   */
  async function convertQuote(
    ref: string,
    lines: Array<{ description: string; quantity: number; unitMinor: number; position: number }>,
  ): Promise<string> {
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitMinor, 0);
    const quoteId = (
      await db.pg.query<{ id: string }>(
        `insert into quotes (ref, customer_name, customer_email, customer_phone, status,
                             valid_until, total_minor)
         values ($1, 'Charter Guest', 'charter@example.com', '+230 5555 0000', 'sent',
                 current_date + 14, $2)
         returning id`,
        [ref, total],
      )
    ).rows[0]!.id;
    for (const line of lines) {
      await db.pg.query(
        `insert into quote_items
           (quote_id, position, kind, description, quantity, unit_amount_minor, subtotal_minor)
         values ($1, $2, 'custom', $3, $4, $5, $6)`,
        [
          quoteId,
          line.position,
          line.description,
          line.quantity,
          line.unitMinor,
          line.quantity * line.unitMinor,
        ],
      );
    }
    const booking = await ctx.db.rpc<{ id: string }>('api_convert_quote', { quoteId });
    return booking.id;
  }

  it('renders every custom line, and splits net/VAT by the rule every other booking gets', async () => {
    const bookingId = await convertQuote('QRECEIPT1', [
      {
        position: 0,
        description: 'Private catamaran charter, 23 Aug',
        quantity: 1,
        unitMinor: 95000,
      },
      { position: 1, description: 'Skipper & crew', quantity: 2, unitMinor: 12500 },
    ]);

    const { booking, payment } = await loadBookingForReceipt(ctx, bookingId);
    const invoice = buildInvoice(booking, payment, INVOICE_BUSINESS);

    // 1) The lines are ON the document, in the operator's order, each carrying its own money.
    expect(invoice.lines.map((line) => line.description)).toEqual([
      'Private catamaran charter, 23 Aug',
      'Skipper & crew',
    ]);
    expect(invoice.lines.map((line) => line.lineGrossEur)).toEqual([950, 250]);
    // `pax` is null on a custom line, so buildInvoice's `pax ?? quantity` prints the quantity sold.
    expect(invoice.lines.map((line) => line.quantity)).toEqual([1, 2]);
    expect(invoice.lines.map((line) => line.unitGrossEur)).toEqual([950, 125]);

    // 2) The lines reconcile to the charge, which is what api_convert_quote's total check buys.
    expect(round2(invoice.lines.reduce((sum, line) => sum + line.lineGrossEur, 0))).toBe(
      invoice.totalGrossEur,
    );
    expect(invoice.totalGrossEur).toBe(1200);

    // 3) The VAT split is the ordinary inclusive one: net per line, VAT as the residual.
    const expectedNet = round2(
      invoice.lines.reduce(
        (net, line) => net + round2(line.lineGrossEur / (1 + VAT_RATE_PCT / 100)),
        0,
      ),
    );
    expect(invoice.subtotalNetEur).toBe(expectedNet);
    expect(invoice.vatAmountEur).toBe(round2(invoice.totalGrossEur - expectedNet));
    expect(invoice.vatRatePct).toBe(VAT_RATE_PCT);

    // 4) …and therefore NOT the old answer, where an empty `lines` made the whole charge VAT.
    expect(
      invoice.vatAmountEur,
      'the invoice is claiming the entire charge was tax — the lines never reached buildInvoice',
    ).not.toBe(invoice.totalGrossEur);
    expect(invoice.subtotalNetEur).toBeGreaterThan(0);
    expect(invoice.vatAmountEur).toBeCloseTo(156.52, 2);
  });

  it('keeps the custom lines in position order, after any booking_items rows', async () => {
    // Position order, not insertion order and certainly not `id` order (gen_random_uuid()).
    const bookingId = await convertQuote('QRECEIPT2', [
      { position: 2, description: 'Fuel surcharge', quantity: 1, unitMinor: 4000 },
      { position: 0, description: 'Villa transfer', quantity: 1, unitMinor: 6000 },
      { position: 1, description: 'Picnic hamper', quantity: 1, unitMinor: 3000 },
    ]);

    // A catalogue line cannot reach a quote booking yet (api_convert_quote refuses one), but the day
    // the hold path lands it will — and voucher-pdf.ts reads `lines[0].quantity` positionally for its
    // pax count, so a booking_items row must stay FIRST. Written straight onto the booking here
    // because that ordering is the receipt's contract, not the conversion RPC's.
    const seeded = await seedOccurrence(db, 10);
    await db.pg.query(
      `insert into booking_items
         (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, pax,
          unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 1, 4, 20000, 20000)`,
      [bookingId, seeded.occurrenceId, seeded.optionId],
    );

    const { booking } = await loadBookingForReceipt(ctx, bookingId);
    expect(booking.items.map((item) => item.priceLabel)).toEqual([
      'Adult',
      'Villa transfer',
      'Picnic hamper',
      'Fuel surcharge',
    ]);
    expect(booking.items[0]!.pax).toBe(4);
    expect(booking.items.slice(1).every((item) => item.pax === null)).toBe(true);
  });

  it('leaves a booking with no custom lines exactly as it was', async () => {
    // The union has to be free for every ordinary booking: an empty aggregate, appended to nothing.
    const seeded = await seedOccurrence(db, 10);
    const bookingId = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (customer_name, customer_email, status, total_minor, payment_state)
         values ('Web Guest', 'web@example.com', 'confirmed', 20000, 'paid') returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into booking_items
         (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, pax,
          unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 1, 2, 20000, 20000)`,
      [bookingId, seeded.occurrenceId, seeded.optionId],
    );

    const { booking } = await loadBookingForReceipt(ctx, bookingId);
    expect(booking.items).toHaveLength(1);
    expect(booking.items[0]!.priceLabel).toBe('Adult');
  });
});
