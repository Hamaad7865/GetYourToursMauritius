import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { createBooking } from '@/lib/services/bookings';

/**
 * The server-side reconciliation sweep re-queries Peach for a payment's status, which needs the Peach
 * checkout id persisted on the payment row. api_record_payment_checkout is SECURITY DEFINER (bypasses
 * payments RLS), so it carries the same IDOR guard as api_record_payment_charge: only staff or the
 * booking owner may write. Unlike the charge (record-once), the checkout id OVERWRITES — a re-pay opens
 * a fresh checkout and the sweep must query the latest one.
 *
 * These call the RPC directly so we can flip the caller's auth.uid()/role precisely.
 */
const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

describe('api_record_payment_checkout persists + overwrites the checkout id, owner/staff only', () => {
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
    const booking = await createBooking(ctx, {
      occurrenceId: occId,
      party: { 'Private group': 2 },
      customer: { name: 'Owner', email: 'owner@example.com' },
      idempotencyKey: 'chk-book-1',
    });
    const created = await db.pg.query<{ data: { paymentId: string } }>(
      `select api_create_payment($1::jsonb) as data`,
      [JSON.stringify({ bookingRef: booking.ref, idempotencyKey: 'chk-pay-1' })],
    );
    paymentId = created.rows[0]!.data.paymentId;
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  const recordCheckout = (checkoutId: string) =>
    db.pg.query<{ data: unknown }>(`select api_record_payment_checkout($1::jsonb) as data`, [
      JSON.stringify({ paymentId, checkoutId }),
    ]);

  const readCheckout = async () => {
    await db.asOwner();
    const row = (
      await db.pg.query<{ provider_checkout_id: string | null }>(
        `select provider_checkout_id from payments where id = $1`,
        [paymentId],
      )
    ).rows[0]!;
    return row;
  };

  it('IDOR: a non-owner authenticated caller is rejected (forbidden) and records nothing', async () => {
    await db.as({ sub: ATTACKER, role: 'authenticated' });
    await expect(recordCheckout('chk_attacker')).rejects.toThrow(/forbidden/);

    const row = await readCheckout();
    expect(row.provider_checkout_id).toBeNull(); // attacker's value never landed
  });

  it('legit: the booking owner can record the checkout id', async () => {
    await db.as({ sub: OWNER, role: 'authenticated' });
    await recordCheckout('chk_123');

    const row = await readCheckout();
    expect(row.provider_checkout_id).toBe('chk_123');
  });

  it('overwrite (re-pay): a second call replaces the checkout id with the latest', async () => {
    // Owner re-pays — a fresh checkout opens; the sweep must query the newest, so latest wins.
    await db.as({ sub: OWNER, role: 'authenticated' });
    await recordCheckout('chk_456');

    const row = await readCheckout();
    expect(row.provider_checkout_id).toBe('chk_456'); // overwritten, not the first value
  });
});
