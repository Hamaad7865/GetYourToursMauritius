import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { createBooking } from '@/lib/services/bookings';
import { createPaymentLink } from '@/lib/services/payments';

/**
 * The booking ledger is EUR, but the Mauritius acquirer settles in USD: createPaymentLink converts the
 * EUR total to whole-dollar USD at charge time. For the receipt/invoice to show what the card was
 * actually billed, that charge (amount + currency) must be persisted on the payment row. This proves
 * createPaymentLink records it via api_record_payment_charge.
 *
 * getUsdRate() hits Frankfurter; we stub fetch to a deterministic rate so the asserted charge is exact
 * and offline. With €110 × 1.10 = $121 → charged_amount_minor = 12100, charged_currency = 'USD'.
 */
const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

const USER = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8';
const RATE = 1.1;

describe('createPaymentLink persists the charged amount + currency', () => {
  let db: TestDb;
  let ctx: ServiceContext;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    ctx = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    };
    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    occurrenceId = rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [USER]);
    await db.as({ sub: USER, role: 'authenticated' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await db.close();
  });

  it('writes charged_amount_minor (USD, round(eur×rate)×100) and charged_currency on the payment row', async () => {
    // Pin the EUR→USD rate so the persisted charge is deterministic (no network in tests).
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ rates: { USD: RATE } }), { status: 200 })),
    );

    const booking = await createBooking(ctx, {
      occurrenceId,
      party: { 'Private group': 2 },
      customer: { name: 'Charge Tester', email: 'charge@example.com' },
      idempotencyKey: 'charge-book-1',
    });
    expect(booking.totalEur).toBe(110); // flat per-group fare

    await createPaymentLink(ctx, {
      bookingRef: booking.ref,
      returnUrl: 'https://example.com/return',
      idempotencyKey: 'charge-pay-1',
    });

    // Read the payment row back as owner (bypass RLS) and assert the charge was recorded.
    await db.asOwner();
    const row = (
      await db.pg.query<{ charged_amount_minor: number | null; charged_currency: string | null }>(
        `select p.charged_amount_minor, p.charged_currency
         from payments p join bookings b on b.id = p.booking_id
         where b.ref = $1`,
        [booking.ref],
      )
    ).rows[0]!;
    await db.as({ sub: USER, role: 'authenticated' });

    const expectedUsd = Math.round(110 * RATE); // 121 whole dollars
    expect(row.charged_currency).toBe('USD');
    expect(row.charged_amount_minor).toBe(expectedUsd * 100); // 12100 minor units
  });
});
