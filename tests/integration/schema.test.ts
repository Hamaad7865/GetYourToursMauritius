import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

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

  it('exposes the Supabase auth shim (auth.uid resolves from JWT claims)', async () => {
    await db.as({ sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated' });
    const { rows } = await db.pg.query<{ uid: string }>(`select auth.uid() as uid`);
    expect(rows[0]!.uid).toBe('11111111-1111-1111-1111-111111111111');
    await db.asOwner();
  });
});
