import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc, pgliteServiceRoleRpc } from '../db/rpc';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { createBooking } from '@/lib/services/bookings';
import { createPaymentLink } from '@/lib/services/payments';

/**
 * Peach now settles the card in EUR (enabled 2026-06-24), so createPaymentLink charges the EUR booking
 * total directly — no FX conversion, and the card statement matches the price shown. For the receipt /
 * invoice to show what the card was actually billed, that charge (amount + currency) is persisted on the
 * payment row. This proves createPaymentLink records it via api_record_payment_charge: €110 →
 * charged_amount_minor = 11000, charged_currency = 'EUR' (equal to the ledger total, no conversion).
 */
const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

const USER = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8';

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

  afterAll(async () => {
    await db.close();
  });

  it('writes charged_amount_minor and charged_currency (EUR, = ledger total) on the payment row', async () => {
    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
      {
        occurrenceId,
        party: { 'Private group': 2 },
        customer: { name: 'Charge Tester', email: 'charge@example.com' },
        idempotencyKey: 'charge-book-1',
      },
    );
    expect(booking.totalEur).toBe(110); // flat per-group fare

    await createPaymentLink(
      ctx,
      {
        bookingRef: booking.ref,
        returnUrl: 'https://example.com/return',
        idempotencyKey: 'charge-pay-1',
      },
      // The two record RPCs are service-role-locked; this mirrors the route's serviceRoleRpcContext().
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
    );

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

    expect(row.charged_currency).toBe('EUR');
    expect(row.charged_amount_minor).toBe(11000); // €110 in minor units — equal to the ledger total
  });
});

/**
 * api_record_payment_charge is SECURITY DEFINER, so it bypasses payments RLS. Since 20260807000000 it
 * is locked to service_role at the GRANT level: the recorded charge feeds the customer's VAT invoice,
 * and the values are caller input, so even the booking OWNER must not be able to write them (they could
 * falsify their own invoice's charge figures). Only the server (createPaymentLink), which derives the
 * values from the provider charge it just created, may record — plus the record-once clause (a re-pay
 * at a moved FX rate must not overwrite the first recorded charge).
 *
 * These call the RPC directly so we can flip the caller's auth.uid()/role precisely.
 */
describe('api_record_payment_charge authorization + record-once guards', () => {
  const OWNER = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
  const ATTACKER = 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2';
  let db: TestDb;
  let paymentId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    await db.pg.query(`insert into auth.users (id) values ($1)`, [OWNER]);
    await db.pg.query(`insert into auth.users (id) values ($1)`, [ATTACKER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [OWNER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [ATTACKER]);

    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    const occId = rows[0]!.id;

    // Owner books + creates a payment via the real RPC path (runs as the owner).
    await db.as({ sub: OWNER, role: 'authenticated' });
    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    };
    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
      {
        occurrenceId: occId,
        party: { 'Private group': 2 },
        customer: { name: 'Owner', email: 'owner@example.com' },
        idempotencyKey: 'guard-book-1',
      },
    );
    // createBooking (api_book) only creates the booking; the payment row comes from api_create_payment
    // (also owner-or-staff guarded, so this runs as the owner).
    const created = await db.pg.query<{ data: { paymentId: string } }>(
      `select api_create_payment($1::jsonb) as data`,
      [JSON.stringify({ bookingRef: booking.ref, idempotencyKey: 'guard-pay-1' })],
    );
    paymentId = created.rows[0]!.data.paymentId;
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  const recordCharge = (minor: number, currency: string) =>
    db.pg.query<{ data: unknown }>(`select api_record_payment_charge($1::jsonb) as data`, [
      JSON.stringify({ paymentId, chargedAmountMinor: minor, chargedCurrency: currency }),
    ]);

  const readCharge = async () => {
    await db.asOwner();
    const row = (
      await db.pg.query<{ charged_amount_minor: number | null; charged_currency: string | null }>(
        `select charged_amount_minor, charged_currency from payments where id = $1`,
        [paymentId],
      )
    ).rows[0]!;
    return row;
  };

  it('a non-owner authenticated caller is denied at the grant layer and records nothing', async () => {
    await db.as({ sub: ATTACKER, role: 'authenticated' });
    await expect(recordCharge(99900, 'USD')).rejects.toThrow(/permission denied/);

    const row = await readCharge();
    expect(row.charged_amount_minor).toBeNull(); // attacker's value never landed
    expect(row.charged_currency).toBeNull();
  });

  it('even the BOOKING OWNER cannot record a charge (invoice-falsification lockdown)', async () => {
    // The charge figures land on the owner's own VAT invoice — the values are caller input, so the
    // owner writing them would let them falsify their own receipt. Server-only since 20260807000000.
    await db.as({ sub: OWNER, role: 'authenticated' });
    await expect(recordCharge(1, 'USD')).rejects.toThrow(/permission denied/);

    const row = await readCharge();
    expect(row.charged_amount_minor).toBeNull();
  });

  it('legit: the server (service_role, as createPaymentLink runs) records the charge', async () => {
    await db.as({ sub: 'service', role: 'service_role' });
    await recordCharge(12100, 'USD');

    const row = await readCharge();
    expect(row.charged_amount_minor).toBe(12100);
    expect(row.charged_currency).toBe('USD');
  });

  it('record-once (FX drift): a second call does NOT overwrite an already-recorded charge', async () => {
    // A re-pay of an older checkout after the rate moved — the new (wrong) amount must not stick.
    await db.as({ sub: 'service', role: 'service_role' });
    await recordCharge(13000, 'USD'); // succeeds (no error) but is a no-op on the already-set row

    const row = await readCharge();
    expect(row.charged_amount_minor).toBe(12100); // still the first recorded value
    expect(row.charged_currency).toBe('USD');
  });
});
