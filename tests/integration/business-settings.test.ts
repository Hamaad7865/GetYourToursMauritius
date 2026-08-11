import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * `business_settings` (20260922000000) against the REAL schema: the singleton, its public-read /
 * staff-update RLS, and the digit-range CHECK that keeps a malformed number out of the link builder.
 *
 * The boundary that matters: the number is world-readable (it is shown on every page), but only staff
 * may change it — and a signed-in customer is NOT staff, so their update must silently touch nothing
 * rather than error into a 500.
 */
const STAFF = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const CUSTOMER = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';

async function currentNumber(db: TestDb): Promise<string | null> {
  await db.asOwner();
  const { rows } = await db.pg.query<{ whatsapp_number: string | null }>(
    `select whatsapp_number from business_settings`,
  );
  return rows[0]?.whatsapp_number ?? null;
}

describe('business_settings (RLS + CHECK)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Owner', 'admin')`, [
      STAFF,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role) values ($1, 'Guest', 'customer')`,
      [CUSTOMER],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('seeds exactly one row, number null by default', async () => {
    await db.asOwner();
    const { rows } = await db.pg.query(`select id, whatsapp_number from business_settings`);
    expect(rows).toEqual([{ id: true, whatsapp_number: null }]);
  });

  it('is readable by an anonymous visitor', async () => {
    await db.as(null);
    const { rows } = await db.pg.query(`select whatsapp_number from business_settings`);
    expect(rows).toHaveLength(1);
  });

  it('lets staff set the number', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(
      `update business_settings set whatsapp_number = '+230 5772 9919' where id = true`,
    );
    expect(await currentNumber(db)).toBe('+230 5772 9919');
  });

  it('lets staff clear the number back to null', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(
      `update business_settings set whatsapp_number = '23011112222' where id = true`,
    );
    await db.pg.query(`update business_settings set whatsapp_number = null where id = true`);
    expect(await currentNumber(db)).toBeNull();
  });

  it('does NOT let a signed-in customer change it (RLS matches no row)', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(
      `update business_settings set whatsapp_number = '23011112222' where id = true`,
    );

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    // No error (the customer holds the UPDATE grant) — RLS just filters the row out, so 0 rows change.
    await db.pg.query(
      `update business_settings set whatsapp_number = '23099998888' where id = true`,
    );

    expect(await currentNumber(db)).toBe('23011112222');
  });

  it('does NOT let an anonymous visitor change it (no update grant)', async () => {
    await db.as(null);
    await expect(
      db.pg.query(`update business_settings set whatsapp_number = '23099998888' where id = true`),
    ).rejects.toThrow();
  });

  it('rejects a number with too few digits (CHECK)', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      db.pg.query(`update business_settings set whatsapp_number = '123' where id = true`),
    ).rejects.toThrow();
  });

  it('rejects a number with too many digits (CHECK)', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      db.pg.query(
        `update business_settings set whatsapp_number = '1234567890123456' where id = true`,
      ),
    ).rejects.toThrow();
  });
});
