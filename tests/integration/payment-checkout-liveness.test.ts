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
import type {
  CheckoutSession,
  CreateCheckoutInput,
  PaymentEvent,
  PaymentProvider,
  VerifyWebhookInput,
} from '@/lib/payments/types';

/**
 * The payment trap (found in production 2026-07-24, booking BMTE5CAD9FB1A5E3).
 *
 * A customer who abandons the Peach widget leaves the session TERMINAL — Peach's status endpoint
 * reports `100.396.101 Cancelled by user`. Nothing cleared `payments.provider_checkout_id`, so
 * api_create_payment's double-charge guard kept handing that dead session back, and the widget
 * bounced the customer straight to their booking page (EmbeddedCheckout.onCancelled). Every retry
 * repeated it, so the booking could never be paid.
 *
 * Two independent defects kept it alive; both are covered here:
 *  1. the reuse guard never checked whether the session was still payable;
 *  2. the 25-minute "is this checkout fresh" window was anchored to `payments.updated_at`, a generic
 *     row-mtime. The reconcile sweep re-queries a dead checkout every few minutes, and its ledger
 *     append is deduped to nothing (same provider_event_id) but STILL bumped updated_at — so the
 *     window was re-armed indefinitely and the 25-minute escape hatch never fired.
 */
const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

const USER = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';

/** Peach's real "the customer closed/abandoned the widget" status payload. */
const CANCELLED_BY_USER = {
  'result.code': '100.396.101',
  'result.description': 'Cancelled by user',
};

/**
 * Provider double whose `getCheckoutStatus` is scripted per test, and which counts createCheckout
 * calls so "did we mint a SECOND payable session?" is directly observable.
 */
class ScriptedProvider implements PaymentProvider {
  readonly name = 'scripted';
  created: string[] = [];
  statusCalls = 0;
  /** What getCheckoutStatus should do next. */
  status: { kind: 'cancelled' } | { kind: 'pending' } | { kind: 'paid' } | { kind: 'throws' } = {
    kind: 'pending',
  };

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const id = `chk_${this.created.length + 1}`;
    this.created.push(input.bookingRef);
    return { id, checkoutId: id, provider: this.name };
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<PaymentEvent> {
    throw new Error('not used');
  }

  async getCheckoutStatus(checkoutId: string): Promise<PaymentEvent> {
    this.statusCalls += 1;
    if (this.status.kind === 'throws') throw new Error('peach unreachable');
    const base = { bookingRef: null, providerReference: checkoutId, amountMinor: null };
    if (this.status.kind === 'cancelled') {
      return {
        ...base,
        outcome: 'failed',
        currency: null,
        checkoutTerminal: true,
        raw: CANCELLED_BY_USER,
      };
    }
    if (this.status.kind === 'paid') {
      return { ...base, outcome: 'paid', currency: 'EUR', raw: { 'result.code': '000.100.110' } };
    }
    return {
      ...base,
      outcome: 'pending',
      currency: null,
      raw: { 'result.code': '000.200.100', 'result.description': 'successfully created checkout' },
    };
  }
}

describe('a cancelled Peach session is never handed back to the customer', () => {
  let db: TestDb;
  let provider: ScriptedProvider;
  let ctx: ServiceContext;
  let adminCtx: ServiceContext;
  let bookingRef: string;

  const pay = (idempotencyKey: string) =>
    createPaymentLink(
      ctx,
      { bookingRef, returnUrl: 'https://example.com/r', idempotencyKey },
      adminCtx,
    );

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    await db.pg.query(`insert into auth.users (id) values ($1)`, [USER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [USER]);

    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );

    provider = new ScriptedProvider();
    ctx = {
      db: pgliteRpc(db.pg),
      payments: provider,
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    };
    adminCtx = { ...ctx, db: pgliteServiceRoleRpc(db.pg) };

    await db.as({ sub: USER, role: 'authenticated' });
    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg), payments: new StubPaymentProvider() },
      {
        occurrenceId: rows[0]!.id,
        party: { 'Private group': 2 },
        customer: { name: 'Eve', email: 'eve@example.com' },
        idempotencyKey: 'live-book-1',
      },
    );
    bookingRef = booking.ref;
    await db.as({ sub: USER, role: 'authenticated' });
  });

  afterAll(async () => {
    await db.close();
  });

  const checkoutRow = async () => {
    await db.asOwner();
    const row = (
      await db.pg.query<{
        provider_checkout_id: string | null;
        prev_provider_checkout_id: string | null;
        checkout_created_at: string | null;
        updated_at: string;
      }>(
        `select p.provider_checkout_id, p.prev_provider_checkout_id, p.checkout_created_at, p.updated_at
           from payments p join bookings b on b.id = p.booking_id where b.ref = $1`,
        [bookingRef],
      )
    ).rows[0]!;
    await db.as({ sub: USER, role: 'authenticated' });
    return row;
  };

  it('mints the first checkout and records it', async () => {
    const link = await pay('live-pay-1');
    expect(link.checkoutId).toBe('chk_1');
    expect(provider.created).toHaveLength(1);
    expect((await checkoutRow()).provider_checkout_id).toBe('chk_1');
  });

  it('REUSES a session Peach still reports as payable — the double-charge guard must hold', async () => {
    provider.status = { kind: 'pending' };
    const link = await pay('live-pay-2');

    expect(link.checkoutId).toBe('chk_1'); // same session handed back
    expect(provider.created).toHaveLength(1); // and NO second payable session was minted
  });

  it('reuses when the status query fails — never mint blindly on an unknown state', async () => {
    provider.status = { kind: 'throws' };
    const link = await pay('live-pay-3');

    expect(link.checkoutId).toBe('chk_1');
    expect(provider.created).toHaveLength(1);
  });

  it('reuses a session Peach reports as PAID — a second session could double-charge', async () => {
    provider.status = { kind: 'paid' };
    const link = await pay('live-pay-4');

    expect(link.checkoutId).toBe('chk_1');
    expect(provider.created).toHaveLength(1);
  });

  it('MINTS A FRESH session when Peach reports the old one cancelled (the trap)', async () => {
    provider.status = { kind: 'cancelled' };
    const link = await pay('live-pay-5');

    expect(link.checkoutId).toBe('chk_2'); // a NEW, payable session — not the dead one
    expect(provider.created).toHaveLength(2);

    const row = await checkoutRow();
    expect(row.provider_checkout_id).toBe('chk_2');
    // The dead id is kept as `prev` so the sweep still ingests a late capture on it.
    expect(row.prev_provider_checkout_id).toBe('chk_1');
  });
});

describe('the 25-minute reuse window is anchored to the checkout, not to row mtime', () => {
  let db: TestDb;
  let paymentId: string;
  let bookingRef: string;

  const createPayment = (key: string) =>
    db.pg
      .query<{
        data: { existingCheckoutId: string | null; checkoutPending?: boolean | null };
      }>(`select api_create_payment($1::jsonb) as data`, [
        JSON.stringify({ bookingRef, idempotencyKey: key }),
      ])
      .then((r) => r.rows[0]!.data);

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    await db.pg.query(`insert into auth.users (id) values ($1)`, [USER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [USER]);

    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    };
    await db.as({ sub: USER, role: 'authenticated' });
    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
      {
        occurrenceId: rows[0]!.id,
        party: { 'Private group': 2 },
        customer: { name: 'Eve', email: 'eve2@example.com' },
        idempotencyKey: 'anchor-book-1',
      },
    );
    bookingRef = booking.ref;
    paymentId = (await createPayment('anchor-pay-1')).existingCheckoutId
      ? ''
      : (
          await db.pg.query<{ id: string }>(
            `select p.id from payments p join bookings b on b.id = p.booking_id where b.ref = $1`,
            [bookingRef],
          )
        ).rows[0]!.id;

    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_record_payment_checkout($1::jsonb)`, [
      JSON.stringify({ paymentId, checkoutId: 'chk_anchor' }),
    ]);
    await db.as({ sub: USER, role: 'authenticated' });
  });

  afterAll(async () => {
    await db.close();
  });

  it('a checkout minted >25 min ago is NOT reused even when the row was touched since', async () => {
    // Exactly the production shape: the checkout was minted 40 minutes ago (dead), but the reconcile
    // sweep touched the row seconds ago — its deduped ledger append bumps updated_at without
    // recording anything. Anchoring on updated_at re-armed the window forever; anchoring on
    // checkout_created_at lets the stale-session escape hatch actually fire.
    await db.asOwner();
    await db.pg.query(
      `update payments set checkout_created_at = now() - interval '40 minutes', updated_at = now()
        where id = $1`,
      [paymentId],
    );
    await db.as({ sub: USER, role: 'authenticated' });

    const out = await createPayment('anchor-pay-2');
    expect(out.existingCheckoutId).toBeNull(); // stale — the caller claims and re-mints
  });

  it('a freshly-minted checkout IS still reused (the guard itself is intact)', async () => {
    await db.asOwner();
    await db.pg.query(
      `update payments set checkout_created_at = now(), checkout_claimed_until = null where id = $1`,
      [paymentId],
    );
    await db.as({ sub: USER, role: 'authenticated' });

    const out = await createPayment('anchor-pay-3');
    expect(out.existingCheckoutId).toBe('chk_anchor');
  });
});

describe('api_clear_payment_checkout', () => {
  let db: TestDb;
  let paymentId: string;
  let bookingRef: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    await db.pg.query(`insert into auth.users (id) values ($1)`, [USER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [USER]);

    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    };
    await db.as({ sub: USER, role: 'authenticated' });
    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
      {
        occurrenceId: rows[0]!.id,
        party: { 'Private group': 2 },
        customer: { name: 'Eve', email: 'eve3@example.com' },
        idempotencyKey: 'clear-book-1',
      },
    );
    bookingRef = booking.ref;
    await db.pg.query(`select api_create_payment($1::jsonb)`, [
      JSON.stringify({ bookingRef, idempotencyKey: 'clear-pay-1' }),
    ]);
    await db.asOwner();
    paymentId = (
      await db.pg.query<{ id: string }>(
        `select p.id from payments p join bookings b on b.id = p.booking_id where b.ref = $1`,
        [bookingRef],
      )
    ).rows[0]!.id;
    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_record_payment_checkout($1::jsonb)`, [
      JSON.stringify({ paymentId, checkoutId: 'chk_dead' }),
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  const clear = (checkoutId: string | null) =>
    db.pg.query(`select api_clear_payment_checkout($1::jsonb)`, [
      JSON.stringify(checkoutId === null ? { paymentId } : { paymentId, checkoutId }),
    ]);

  const row = async () => {
    await db.asOwner();
    const r = (
      await db.pg.query<{
        provider_checkout_id: string | null;
        prev_provider_checkout_id: string | null;
        checkout_created_at: string | null;
      }>(
        `select provider_checkout_id, prev_provider_checkout_id, checkout_created_at
           from payments where id = $1`,
        [paymentId],
      )
    ).rows[0]!;
    return r;
  };

  it('is server-only — an authenticated customer cannot clear their own pointer', async () => {
    await db.as({ sub: USER, role: 'authenticated' });
    await expect(clear('chk_dead')).rejects.toThrow(/permission denied/);
    expect((await row()).provider_checkout_id).toBe('chk_dead');
  });

  it('ignores a stale compare-and-clear (someone else already minted a newer session)', async () => {
    await db.as({ role: 'service_role' });
    await clear('chk_someone_elses');
    expect((await row()).provider_checkout_id).toBe('chk_dead'); // untouched
  });

  it('clears the dead pointer into prev_ and drops the mint timestamp', async () => {
    await db.as({ role: 'service_role' });
    await clear('chk_dead');

    const r = await row();
    expect(r.provider_checkout_id).toBeNull();
    expect(r.prev_provider_checkout_id).toBe('chk_dead'); // sweep still covers a late capture
    expect(r.checkout_created_at).toBeNull();
  });
});
