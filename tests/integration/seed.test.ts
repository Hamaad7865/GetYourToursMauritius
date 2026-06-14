import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';

const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

const CATEGORIES = [
  'Catamaran cruises',
  'Île aux Cerfs',
  'Dolphin swims',
  'Sea walks & diving',
  'Parasailing',
  'Island tours',
  'Airport transfers',
];

describe('catalogue seed', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.pg.exec(catalogueToSeedSql(catalogue));
  });

  afterAll(async () => {
    await db.close();
  });

  it('validates against the catalogue schema with a full catalogue', () => {
    expect(catalogue.operator.slug).toBe('belle-mare-tours');
    expect(catalogue.activities.length).toBeGreaterThanOrEqual(20);
  });

  it('loads every activity with EN + FR translations', async () => {
    const { rows: total } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from activities`,
    );
    expect(total[0]!.n).toBe(catalogue.activities.length);

    const { rows: bilingual } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from activities a
       where exists (select 1 from activity_translations t where t.activity_id = a.id and t.locale = 'en')
         and exists (select 1 from activity_translations t where t.activity_id = a.id and t.locale = 'fr')`,
    );
    expect(bilingual[0]!.n).toBe(catalogue.activities.length);
  });

  it('maps every activity to one of the seven categories', async () => {
    const { rows } = await db.pg.query<{ category: string }>(
      `select distinct category::text as category from activities`,
    );
    for (const row of rows) {
      expect(CATEGORIES).toContain(row.category);
    }
  });

  it('prices transport from real figures and supports price-on-request activities', async () => {
    const { rows: transfer } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from activity_option_prices p
       join activity_options o on o.id = p.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'airport-transfer'`,
    );
    expect(transfer[0]!.n).toBe(5); // 5 vehicle classes, each priced per transfer

    const { rows: south } = await db.pg.query<{ amount_minor: number }>(
      `select amount_minor from activity_option_prices p
       join activity_options o on o.id = p.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup'`,
    );
    expect(south[0]!.amount_minor).toBe(11000); // €110 from the brief

    // an unpublished-price activity has an option but no price tier (enquiry flow)
    const { rows: noPrice } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from activity_option_prices p
       join activity_options o on o.id = p.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'swim-with-dolphins'`,
    );
    expect(noPrice[0]!.n).toBe(0);
  });

  it('produces bookable inventory the booking core accepts', async () => {
    const { rows: occ } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup'
       limit 1`,
    );
    expect(occ).toHaveLength(1);

    const { rows: hold } = await db.pg.query<{ quantity: number }>(
      `select * from create_hold($1, $2, $3)`,
      [occ[0]!.id, 2, 'seed-hold-1'],
    );
    expect(hold[0]!.quantity).toBe(2);
  });
});
