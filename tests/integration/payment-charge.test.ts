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
 * The ledger stays EUR while the card is charged in the currency the owner switched to in /admin
 * (business_settings.charge_currency — MUR, the default, or EUR since 2026-10-17). The charge is
 * PINNED once per payment row inside create_payment, in SQL: a MUR charge is the EUR total at the
 * owner-set business_settings.eur_mur_rate in WHOLE RUPEES, an EUR charge is the EUR total exactly;
 * createPaymentLink charges exactly the pinned figure. These tests prove the load-bearing properties
 * of that pin:
 *
 *   1. the pin itself: €110 at 53.98 → charged_amount_minor = 593800 (5938 whole rupees),
 *      charged_currency = 'MUR', charged_fx_rate persisted — while the EUR ledger row
 *      (amount_minor = 11000, currency = 'EUR') is untouched;
 *   2. sent == recorded: the amount handed to the provider is byte-identical to the pin
 *      ((minor/100).toFixed(2) round-trips exactly because the pin is a multiple of 100);
 *   3. re-mint stability — THE reason the pin lives in SQL: a replacement checkout session minted
 *      after the FX rate moved still charges the ORIGINAL pinned figure, so the expected settlement
 *      and the actual charge can never drift apart across sessions.
 */
const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

const USER = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8';

/** Set the EUR→MUR rate as the admin card does (owner context, direct row write); null = never set. */
async function setRate(db: TestDb, rate: number | null): Promise<void> {
  await db.asOwner();
  await db.pg.query(
    `update business_settings set eur_mur_rate = $1, eur_mur_rate_updated_at = now() where id = true`,
    [rate],
  );
}

/** Flip the admin switch (owner context, direct row write). */
async function setChargeCurrency(db: TestDb, currency: 'MUR' | 'EUR'): Promise<void> {
  await db.asOwner();
  await db.pg.query(`update business_settings set charge_currency = $1 where id = true`, [
    currency,
  ]);
}

describe('api_create_payment pins the MUR charge; createPaymentLink charges exactly it', () => {
  let db: TestDb;
  let ctx: ServiceContext;
  let stub: StubPaymentProvider;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    stub = new StubPaymentProvider();
    ctx = {
      db: pgliteRpc(db.pg),
      payments: stub,
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    };
    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    occurrenceId = rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [USER]);
    await setRate(db, 53.98);
    await db.as({ sub: USER, role: 'authenticated' });
  });

  afterAll(async () => {
    await db.close();
  });

  it('pins whole-rupee MUR on the payment row and leaves the EUR ledger untouched', async () => {
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

    const link = await createPaymentLink(
      ctx,
      {
        bookingRef: booking.ref,
        returnUrl: 'https://example.com/return',
        idempotencyKey: 'charge-pay-1',
      },
      // api_record_payment_checkout / api_clear_payment_checkout are service-role-locked; this
      // mirrors the route's serviceRoleRpcContext().
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
    );

    // The link surfaces the pinned charge for the pay page's disclosure.
    expect(link.chargeCurrency).toBe('MUR');
    expect(link.chargeAmountMinor).toBe(593800); // 11000 * 53.98/100 = 5937.8 → 5938 whole rupees

    await db.asOwner();
    const row = (
      await db.pg.query<{
        amount_minor: number;
        currency: string;
        charged_amount_minor: number | null;
        charged_currency: string | null;
        charged_fx_rate: string | number | null;
        charged_fx_source: string | null;
      }>(
        `select p.amount_minor, p.currency, p.charged_amount_minor, p.charged_currency,
                p.charged_fx_rate, p.charged_fx_source
         from payments p join bookings b on b.id = p.booking_id
         where b.ref = $1`,
        [booking.ref],
      )
    ).rows[0]!;
    await db.as({ sub: USER, role: 'authenticated' });

    // The pin.
    expect(row.charged_currency).toBe('MUR');
    expect(Number(row.charged_amount_minor)).toBe(593800);
    expect(Number(row.charged_amount_minor) % 100).toBe(0); // WHOLE rupees, always
    expect(Number(row.charged_fx_rate)).toBeCloseTo(53.98, 6);
    expect(row.charged_fx_source).toBe('admin');
    // The EUR ledger — untouched by the currency change.
    expect(row.amount_minor).toBe(11000);
    expect(row.currency).toBe('EUR');

    // Sent == recorded: the provider was asked for exactly the pinned figure, in MUR. The stub
    // records what it was asked to charge; its status re-query reports it back in minor units.
    const status = await stub.getCheckoutStatus(link.sessionId);
    expect(status.amountMinor).toBe(593800);
    expect(status.currency).toBe('MUR');
  });

  it('re-mint after an FX move charges the SAME pinned figure (the drift the SQL pin exists to kill)', async () => {
    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
      {
        occurrenceId,
        party: { 'Private group': 2 },
        customer: { name: 'Remint Tester', email: 'remint@example.com' },
        idempotencyKey: 'remint-book-1',
      },
    );

    const first = await createPaymentLink(
      ctx,
      { bookingRef: booking.ref, returnUrl: 'https://example.com/r', idempotencyKey: 'remint-pay' },
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
    );
    expect(first.chargeAmountMinor).toBe(593800);

    // Read the payment id directly (test introspection — api_create_payment enforces booking
    // ownership on the caller, so it can't be used as a lookup under service_role).
    await db.asOwner();
    const paymentId = (
      await db.pg.query<{ id: string }>(
        `select p.id from payments p join bookings b on b.id = p.booking_id where b.ref = $1`,
        [booking.ref],
      )
    ).rows[0]!.id;

    // The provider declares the session dead → the service retires it (compare-and-clear), exactly
    // the cancelled-checkout flow. Then the RATE MOVES. (Service-role claims carry no sub.)
    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_clear_payment_checkout($1::jsonb)`, [
      JSON.stringify({ paymentId, checkoutId: first.sessionId }),
    ]);
    await setRate(db, 51.5);
    await db.as({ sub: USER, role: 'authenticated' });

    const second = await createPaymentLink(
      ctx,
      { bookingRef: booking.ref, returnUrl: 'https://example.com/r', idempotencyKey: 'remint-pay' },
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
    );

    // First-write-wins is the DESIGN, not an accident: the replacement session charges the original
    // pin, so whichever session settles matches the recorded expectation exactly.
    expect(second.chargeAmountMinor).toBe(593800);
    await db.asOwner();
    const row = (
      await db.pg.query<{ charged_amount_minor: number | null }>(
        `select p.charged_amount_minor from payments p
         join bookings b on b.id = p.booking_id where b.ref = $1`,
        [booking.ref],
      )
    ).rows[0]!;
    expect(Number(row.charged_amount_minor)).toBe(593800);
    await db.as({ sub: USER, role: 'authenticated' });

    // Restore the suite's rate for any later cases.
    await setRate(db, 53.98);
    await db.as({ sub: USER, role: 'authenticated' });
  });

  it('falls back to the in-SQL floor (53.00) when no rate has been set', async () => {
    // A never-set rate (NULL) takes the same read-side belt that refuses an implausible one — an
    // inverted 0.0185 would bill MUR 1.85 for the whole booking and, because settled == charged,
    // CONFIRM it. The column CHECK refuses such a value on write (business-settings.test.ts), so NULL
    // is the reachable way into this branch.
    await setRate(db, null);
    await db.as({ sub: USER, role: 'authenticated' });

    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
      {
        occurrenceId,
        party: { 'Private group': 2 },
        customer: { name: 'Floor Tester', email: 'floor@example.com' },
        idempotencyKey: 'floor-book-1',
      },
    );
    const link = await createPaymentLink(
      ctx,
      { bookingRef: booking.ref, returnUrl: 'https://example.com/r', idempotencyKey: 'floor-pay' },
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
    );

    // €110 at the 53.00 floor → 5830 whole rupees, source recorded as 'fallback'.
    expect(link.chargeAmountMinor).toBe(583000);
    await db.asOwner();
    const row = (
      await db.pg.query<{ charged_fx_source: string | null; charged_fx_rate: string | number }>(
        `select p.charged_fx_source, p.charged_fx_rate from payments p
         join bookings b on b.id = p.booking_id where b.ref = $1`,
        [booking.ref],
      )
    ).rows[0]!;
    expect(row.charged_fx_source).toBe('fallback');
    expect(Number(row.charged_fx_rate)).toBeCloseTo(53.0, 6);

    await setRate(db, 53.98);
    await db.as({ sub: USER, role: 'authenticated' });
  });

  it('switched to EUR, charges the EUR ledger amount to the cent — no conversion, no rounding', async () => {
    await setChargeCurrency(db, 'EUR');
    await db.as({ sub: USER, role: 'authenticated' });

    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
      {
        occurrenceId,
        party: { 'Private group': 2 },
        customer: { name: 'Euro Tester', email: 'euro@example.com' },
        idempotencyKey: 'eur-book-1',
      },
    );
    const link = await createPaymentLink(
      ctx,
      { bookingRef: booking.ref, returnUrl: 'https://example.com/r', idempotencyKey: 'eur-pay' },
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
    );

    expect(link.chargeCurrency).toBe('EUR');
    expect(link.chargeAmountMinor).toBe(11000);
    await db.asOwner();
    const row = (
      await db.pg.query<{
        amount_minor: number;
        charged_amount_minor: number | null;
        charged_currency: string | null;
        charged_fx_rate: string | number | null;
        charged_fx_source: string | null;
      }>(
        `select p.amount_minor, p.charged_amount_minor, p.charged_currency, p.charged_fx_rate,
                p.charged_fx_source
         from payments p join bookings b on b.id = p.booking_id where b.ref = $1`,
        [booking.ref],
      )
    ).rows[0]!;
    expect(row.charged_currency).toBe('EUR');
    expect(Number(row.charged_amount_minor)).toBe(row.amount_minor);
    expect(Number(row.charged_fx_rate)).toBe(1);
    expect(row.charged_fx_source).toBe('same-currency');

    // Sent == recorded, in EUR.
    const status = await stub.getCheckoutStatus(link.sessionId);
    expect(status.amountMinor).toBe(11000);
    expect(status.currency).toBe('EUR');

    await setChargeCurrency(db, 'MUR');
    await db.as({ sub: USER, role: 'authenticated' });
  });

  it('flipping the switch never re-pins a payment row that is already pinned', async () => {
    // A session minted under the old pin stays completable at Peach for ~30 minutes; re-pinning its
    // row would make that settlement a currency_mismatch quarantine. So the switch reaches NEW pins.
    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
      {
        occurrenceId,
        party: { 'Private group': 2 },
        customer: { name: 'Flip Tester', email: 'flip@example.com' },
        idempotencyKey: 'flip-book-1',
      },
    );
    const first = await createPaymentLink(
      ctx,
      { bookingRef: booking.ref, returnUrl: 'https://example.com/r', idempotencyKey: 'flip-pay' },
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
    );
    expect(first.chargeCurrency).toBe('MUR');

    await db.asOwner();
    const paymentId = (
      await db.pg.query<{ id: string }>(
        `select p.id from payments p join bookings b on b.id = p.booking_id where b.ref = $1`,
        [booking.ref],
      )
    ).rows[0]!.id;
    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_clear_payment_checkout($1::jsonb)`, [
      JSON.stringify({ paymentId, checkoutId: first.sessionId }),
    ]);
    await setChargeCurrency(db, 'EUR');
    await db.as({ sub: USER, role: 'authenticated' });

    const second = await createPaymentLink(
      ctx,
      { bookingRef: booking.ref, returnUrl: 'https://example.com/r', idempotencyKey: 'flip-pay' },
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
    );
    expect(second.chargeCurrency).toBe('MUR');
    expect(second.chargeAmountMinor).toBe(593800);

    await setChargeCurrency(db, 'MUR');
    await db.as({ sub: USER, role: 'authenticated' });
  });

  it('a booking that already took money in MUR is charged the rest in MUR after the switch flips', async () => {
    // One booking, one charge currency: api_booking_receipt sums the booking + balance rows into ONE
    // charged figure under ONE currency label, so a MUR deposit + EUR balance would print money in no
    // currency on the VAT invoice.
    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
      {
        occurrenceId,
        party: { 'Private group': 2 },
        customer: { name: 'Deposit Tester', email: 'deposit@example.com' },
        idempotencyKey: 'sticky-book-1',
      },
    );
    // A €50 deposit on the €110 booking (a quote booking carries one; set it directly here).
    await db.asOwner();
    await db.pg.query(`update bookings set deposit_minor = 5000 where ref = $1`, [booking.ref]);
    await db.as({ sub: USER, role: 'authenticated' });

    const deposit = await createPaymentLink(
      ctx,
      { bookingRef: booking.ref, returnUrl: 'https://example.com/r', idempotencyKey: 'sticky-dep' },
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
    );
    expect(deposit.chargeCurrency).toBe('MUR');
    expect(deposit.chargeAmountMinor).toBe(269900); // 5000 * 53.98/100 = 2699 whole rupees

    // Settle the deposit through the ledger: confirms the booking, leaves €60 owed.
    await db.asOwner();
    const depositId = (
      await db.pg.query<{ id: string }>(
        `select p.id from payments p join bookings b on b.id = p.booking_id
         where b.ref = $1 and p.purpose = 'booking'`,
        [booking.ref],
      )
    ).rows[0]!.id;
    await db.as({ role: 'service_role' });
    await db.pg.query(`select append_payment_event($1, 'paid', $2, 5000, now(), '{}'::jsonb)`, [
      depositId,
      `${booking.ref}-dep-evt`,
    ]);

    // The owner switches to EUR — then the guest pays the balance.
    await setChargeCurrency(db, 'EUR');
    await db.as({ sub: USER, role: 'authenticated' });
    const balance = (
      await db.pg.query<{ data: { chargedCurrency: string; chargedAmountMinor: number } }>(
        `select api_create_payment($1::jsonb) as data`,
        [
          JSON.stringify({
            bookingRef: booking.ref,
            idempotencyKey: 'sticky-bal',
            purpose: 'balance',
          }),
        ],
      )
    ).rows[0]!.data;
    expect(balance.chargedCurrency).toBe('MUR');
    expect(Number(balance.chargedAmountMinor)).toBe(323900); // 6000 * 53.98/100 = 3238.8 → 3239

    await setChargeCurrency(db, 'MUR');
    await db.as({ sub: USER, role: 'authenticated' });
  });
});

/**
 * api_record_payment_charge is SECURITY DEFINER and locked to service_role (20260807000000), with a
 * record-once clause. Under the pin design the clause has a NEW load-bearing job: api_create_payment
 * writes the charge first, so record-once now protects the PIN — nothing, not even service_role, may
 * overwrite the expected settlement once minted. The standalone RPC still works on a row without a
 * pin (legacy path), which the last case proves against a hand-inserted payment row.
 */
describe('api_record_payment_charge authorization + record-once now protect the pin', () => {
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
    await db.pg.query(`update business_settings set eur_mur_rate = 53.98 where id = true`);

    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    const occId = rows[0]!.id;

    // Owner books + creates a payment via the real RPC path (runs as the owner) — which PINS the
    // charge (€110 at 53.98 → 593800 MUR minor).
    await db.as({ sub: OWNER, role: 'authenticated' });
    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
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

  it('a non-owner authenticated caller is denied at the grant layer; the pin stands', async () => {
    await db.as({ sub: ATTACKER, role: 'authenticated' });
    await expect(recordCharge(99900, 'USD')).rejects.toThrow(/permission denied/);

    const row = await readCharge();
    expect(Number(row.charged_amount_minor)).toBe(593800); // the pin, not the attacker's figure
    expect(row.charged_currency).toBe('MUR');
  });

  it('even the BOOKING OWNER cannot record a charge (invoice-falsification lockdown)', async () => {
    await db.as({ sub: OWNER, role: 'authenticated' });
    await expect(recordCharge(1, 'USD')).rejects.toThrow(/permission denied/);

    const row = await readCharge();
    expect(Number(row.charged_amount_minor)).toBe(593800);
  });

  it('record-once: not even service_role can overwrite the pinned expected settlement', async () => {
    // The pin IS the expected settlement reconcile measures against. If any later write could move
    // it, a session charged at the original figure would quarantine as short/over — so the no-op
    // here is the money-safety property, not a convenience.
    await db.as({ role: 'service_role' });
    await recordCharge(13000, 'USD'); // succeeds (no error) but must be a no-op on the pinned row

    const row = await readCharge();
    expect(Number(row.charged_amount_minor)).toBe(593800);
    expect(row.charged_currency).toBe('MUR');
  });

  it('legacy path: on a payment row WITHOUT a pin, service_role records once, then it locks', async () => {
    // Hand-inserted row (bypasses api_create_payment) — the shape of a pre-cutover payment.
    await db.asOwner();
    const bookingId = (
      await db.pg.query<{ id: string }>(`select booking_id as id from payments where id = $1`, [
        paymentId,
      ])
    ).rows[0]!.id;
    const legacy = (
      await db.pg.query<{ id: string }>(
        `insert into payments (booking_id, idempotency_key, amount_minor, status)
         values ($1, 'legacy-key-1', 11000, 'failed') returning id`,
        [bookingId],
      )
    ).rows[0]!.id;

    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_record_payment_charge($1::jsonb)`, [
      JSON.stringify({ paymentId: legacy, chargedAmountMinor: 12100, chargedCurrency: 'EUR' }),
    ]);
    await db.pg.query(`select api_record_payment_charge($1::jsonb)`, [
      JSON.stringify({ paymentId: legacy, chargedAmountMinor: 999, chargedCurrency: 'USD' }),
    ]);

    await db.asOwner();
    const row = (
      await db.pg.query<{ charged_amount_minor: number | null; charged_currency: string | null }>(
        `select charged_amount_minor, charged_currency from payments where id = $1`,
        [legacy],
      )
    ).rows[0]!;
    expect(Number(row.charged_amount_minor)).toBe(12100); // first write; the second was a no-op
    expect(row.charged_currency).toBe('EUR');
  });
});
