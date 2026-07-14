import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * supabase/recover-catalogue.sql re-seeds the base catalogue after a schema rebuild (operator-agnostic —
 * looks the operator up by slug so it binds to the real row instead of a hardcoded UUID). Proves it
 * applies on top of a freshly migrated schema and brings the ~32 activities (with options/prices/images)
 * back.
 *
 * The base schema comes from createTestDb() (the auth shim + every migration in filename order) — NOT
 * from setup.sql, which bundles the seed: a pre-seeded base would let the ">= 30 activities" assertion
 * below pass even if recover-catalogue.sql did nothing at all. The assertion only has teeth on an empty
 * catalogue.
 */
describe('recover-catalogue.sql restores the base activities on a rebuilt DB', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.pg.exec(
      readFileSync(join(process.cwd(), 'supabase', 'recover-catalogue.sql'), 'utf8'),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('re-seeds ~32 activities under the belle-mare-tours operator', async () => {
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from activities a
         join operators o on o.id = a.operator_id
        where o.slug = 'belle-mare-tours'`,
    );
    expect(rows[0]!.n).toBeGreaterThanOrEqual(30);
  });

  it('restores deep-sea-fishing with its option, price and images', async () => {
    const { rows } = await db.pg.query<{
      title: string;
      opts: number;
      prices: number;
      imgs: number;
    }>(
      `select a.title,
              (select count(*) from activity_options o where o.activity_id = a.id)::int as opts,
              (select count(*) from activity_option_prices p
                 join activity_options o on o.id = p.activity_option_id where o.activity_id = a.id)::int as prices,
              (select count(*) from activity_images i where i.activity_id = a.id)::int as imgs
         from activities a where a.slug = 'deep-sea-fishing'`,
    );
    expect(rows[0]!.title).toMatch(/deep sea/i);
    expect(rows[0]!.opts).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.prices).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.imgs).toBeGreaterThanOrEqual(1);
  });
});
