import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import {
  bookingSourceSchema,
  bookingStatusSchema,
  paymentStateSchema,
} from '@/lib/validation/common';

/**
 * Postgres enums whose labels the API re-validates on the way OUT, paired with the Zod enum that
 * has to accept every one of them.
 *
 * These are the drift that bites hardest, because it is invisible until a row carrying the new
 * label is read back: `booking_json` hands the value straight to `bookingSchema.parse`, so a label
 * the Zod enum has never heard of throws a ZodError INSIDE a successful read and `apiHandler` turns
 * it into a 500. That is exactly what 'quote' did — 20260909000000_quotes added it to the type and
 * api_convert_quote started writing it, while this list still said web|ai_chat|whatsapp, and every
 * quote-converted booking 500'd on its confirmation page, voucher, invoice, cancel and reschedule.
 *
 * Exact equality, not `toContain`: a label dropped from the DB is drift in the other direction and
 * leaves the API advertising a value nothing can produce.
 */
const ENUM_PARITY: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['booking_source', bookingSourceSchema.options],
  ['booking_status', bookingStatusSchema.options],
  ['payment_state', paymentStateSchema.options],
];

describe('schema: catalogue migrations', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('applies all migrations and supports operator → activity → option → price', async () => {
    const { rows: opRows } = await db.pg.query<{ id: string }>(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours') returning id`,
    );
    const operatorId = opRows[0]!.id;

    const { rows: actRows } = await db.pg.query<{ id: string }>(
      `insert into activities (operator_id, slug, title, category, status)
       values ($1, 'catamaran-bbq', 'Catamaran Cruise with BBQ', 'Catamaran cruises', 'published')
       returning id`,
      [operatorId],
    );
    const activityId = actRows[0]!.id;

    const { rows: optRows } = await db.pg.query<{ id: string }>(
      `insert into activity_options (activity_id, name) values ($1, 'Shared') returning id`,
      [activityId],
    );
    const optionId = optRows[0]!.id;

    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 7500)`,
      [optionId],
    );

    const { rows } = await db.pg.query(
      `select label, amount_minor, currency from activity_option_prices where activity_option_id = $1`,
      [optionId],
    );
    expect(rows).toEqual([{ label: 'Adult', amount_minor: 7500, currency: 'EUR' }]);
  });

  it('enforces the activity_category enum', async () => {
    await expect(db.pg.query(`select 'Not A Category'::activity_category`)).rejects.toThrow();
  });

  it.each(ENUM_PARITY)(
    'keeps the %s enum in step with its Zod schema',
    async (typname, expected) => {
      const { rows } = await db.pg.query<{ label: string }>(
        `select e.enumlabel as label
           from pg_enum e
           join pg_type t on t.oid = e.enumtypid
          where t.typname = $1
          order by e.enumsortorder`,
        [typname],
      );
      const labels = rows.map((row) => row.label);
      expect(labels, `${typname} does not exist in the migrated schema`).not.toHaveLength(0);
      expect(
        [...labels].sort(),
        `${typname} is [${labels.join(', ')}] but its Zod enum accepts [${expected.join(', ')}] — ` +
          `a value only one side knows about 500s every read of a row carrying it`,
      ).toEqual([...expected].sort());
    },
  );

  it('exposes the Supabase auth shim (auth.uid resolves from JWT claims)', async () => {
    await db.as({ sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated' });
    const { rows } = await db.pg.query<{ uid: string }>(`select auth.uid() as uid`);
    expect(rows[0]!.uid).toBe('11111111-1111-1111-1111-111111111111');
    await db.asOwner();
  });
});
