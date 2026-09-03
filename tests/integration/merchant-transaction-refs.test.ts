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

/**
 * `payment_merchant_refs` is what makes an OPAQUE merchantTransactionId safe to send.
 *
 * Peach permanently refuses an id that already carries a successful transaction, so an id DERIVED from
 * the payment row is fixed for that row's life: once burned, the row can never be paid. A generated id
 * is reissued instead — but it carries no booking ref, so this table is the only thing standing between
 * a settlement and the booking it belongs to. If it maps wrongly, money lands on the wrong booking; if
 * it maps not at all, the card is charged and the booking never confirms.
 */
const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

describe('payment_merchant_refs maps an issued id back to its payment', () => {
  const OWNER = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
  let db: TestDb;
  let paymentA: string;
  let paymentB: string;

  const record = (paymentId: string, merchantTxnId: string) =>
    db.pg.query(`select api_record_merchant_ref($1::jsonb)`, [
      JSON.stringify({ paymentId, merchantTxnId }),
    ]);

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    await db.pg.query(`insert into auth.users (id) values ($1)`, [OWNER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [OWNER]);

    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    const occId = rows[0]!.id;

    await db.as({ sub: OWNER, role: 'authenticated' });
    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    };
    const mkPayment = async (key: string) => {
      const booking = await createBooking(
        { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
        {
          occurrenceId: occId,
          party: { 'Private group': 2 },
          customer: { name: 'Owner', email: 'owner@example.com' },
          idempotencyKey: `mtid-book-${key}`,
        },
      );
      const created = await db.pg.query<{ data: { paymentId: string } }>(
        `select api_create_payment($1::jsonb) as data`,
        [JSON.stringify({ bookingRef: booking.ref, idempotencyKey: `mtid-pay-${key}` })],
      );
      return created.rows[0]!.data.paymentId;
    };
    paymentA = await mkPayment('a');
    paymentB = await mkPayment('b');
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  it('records an id against the payment that issued it', async () => {
    await record(paymentA, 'BMT7K3M9QX2VDPR4');
    const { rows } = await db.pg.query<{ payment_id: string }>(
      `select payment_id from payment_merchant_refs where merchant_txn_id = 'BMT7K3M9QX2VDPR4'`,
    );
    expect(rows[0]?.payment_id).toBe(paymentA);
  });

  it('accumulates several ids for one payment, oldest first', async () => {
    // The whole point of the scheme: a burned id is REPLACED, not worked around. The history is also
    // what lets a webhook echoing an older id still find its booking.
    await record(paymentA, 'BMT2H4J6K8M0N2P4');
    const { rows } = await db.pg.query<{ merchant_txn_id: string }>(
      `select merchant_txn_id from payment_merchant_refs
        where payment_id = $1 order by created_at`,
      [paymentA],
    );
    expect(rows.map((r) => r.merchant_txn_id)).toEqual(['BMT7K3M9QX2VDPR4', 'BMT2H4J6K8M0N2P4']);
  });

  it('is idempotent when the same mint is retried', async () => {
    await expect(record(paymentA, 'BMT7K3M9QX2VDPR4')).resolves.toBeDefined();
    const { rows } = await db.pg.query<{ n: string }>(
      `select count(*) as n from payment_merchant_refs where merchant_txn_id = 'BMT7K3M9QX2VDPR4'`,
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('refuses to point an existing id at a different payment', async () => {
    // 65 bits of randomness means this should never happen — but silently remapping would resolve one
    // booking's settlement onto another's money, so it fails loudly rather than quietly.
    await expect(record(paymentB, 'BMT7K3M9QX2VDPR4')).rejects.toThrow(
      /already belongs to payment/,
    );
  });

  it('requires both fields', async () => {
    await expect(record(paymentA, '')).rejects.toThrow(/required/);
  });

  it('is unwritable by anon and authenticated', async () => {
    // Checked with has_table_privilege, NEVER information_schema.role_table_grants, which has already
    // reported a live anon grant as absent once. Supabase's defaults hand a new table the full
    // insert/update/delete set, so this is the assertion that proves the revoke actually landed.
    const { rows } = await db.pg.query<Record<string, boolean>>(
      `select
         has_table_privilege('anon','payment_merchant_refs','SELECT') as anon_select,
         has_table_privilege('anon','payment_merchant_refs','INSERT') as anon_insert,
         has_table_privilege('anon','payment_merchant_refs','UPDATE') as anon_update,
         has_table_privilege('anon','payment_merchant_refs','DELETE') as anon_delete,
         has_table_privilege('authenticated','payment_merchant_refs','INSERT') as auth_insert,
         has_table_privilege('authenticated','payment_merchant_refs','UPDATE') as auth_update,
         has_table_privilege('authenticated','payment_merchant_refs','DELETE') as auth_delete,
         has_table_privilege('authenticated','payment_merchant_refs','SELECT') as auth_select`,
    );
    expect(rows[0]).toMatchObject({
      anon_select: false,
      anon_insert: false,
      anon_update: false,
      anon_delete: false,
      auth_insert: false,
      auth_update: false,
      auth_delete: false,
      // Staff read it through RLS (pmr_staff_select) for the booking drawer's history.
      auth_select: true,
    });
  });
});
