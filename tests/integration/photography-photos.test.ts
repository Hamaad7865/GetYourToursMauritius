import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * `photography_photos` (20261009000000) against the REAL schema: public read, staff-only write, and
 * the CHECKs that keep a row placeable (a known slot, a non-blank URL, known gallery tags).
 */
const STAFF = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2';
const CUSTOMER = 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2';

async function count(db: TestDb): Promise<number> {
  await db.asOwner();
  const { rows } = await db.pg.query<{ n: number }>(
    `select count(*)::int as n from photography_photos`,
  );
  return rows[0]?.n ?? 0;
}

describe('photography_photos (RLS + CHECK)', () => {
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

  it('lets staff add, tag and remove photos', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(
      `insert into photography_photos (slot, url, tags, position)
       values ('gallery', 'https://x.test/a.jpg', '{weddings,films}', 0),
              ('hero', '/photography/own-hero.jpg', '{}', 0)`,
    );
    await db.pg.query(`update photography_photos set alt = 'Beach vows' where slot = 'gallery'`);
    expect(await count(db)).toBe(2);
    await db.as({ sub: STAFF, role: 'authenticated' });
    await db.pg.query(`delete from photography_photos where slot = 'hero'`);
    expect(await count(db)).toBe(1);
  });

  it('is readable by an anonymous visitor', async () => {
    await db.as(null);
    const { rows } = await db.pg.query<{ alt: string; tags: string[] }>(
      `select alt, tags from photography_photos`,
    );
    expect(rows).toEqual([{ alt: 'Beach vows', tags: ['weddings', 'films'] }]);
  });

  it('does not let an anonymous visitor or a customer write', async () => {
    await db.as(null);
    await expect(
      db.pg.query(
        `insert into photography_photos (slot, url) values ('hero', 'https://x.test/b.jpg')`,
      ),
    ).rejects.toThrow();

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      db.pg.query(
        `insert into photography_photos (slot, url) values ('hero', 'https://x.test/b.jpg')`,
      ),
    ).rejects.toThrow();
    // Update/delete: RLS filters the row out, so nothing changes (no error).
    await db.pg.query(`delete from photography_photos`);
    expect(await count(db)).toBe(1);
  });

  it('rejects an unknown slot, a blank url and an unknown gallery tag', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      db.pg.query(
        `insert into photography_photos (slot, url) values ('footer', 'https://x.test/c.jpg')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.pg.query(`insert into photography_photos (slot, url) values ('hero', '   ')`),
    ).rejects.toThrow();
    await expect(
      db.pg.query(
        `insert into photography_photos (slot, url, tags) values ('gallery', 'https://x.test/d.jpg', '{pets}')`,
      ),
    ).rejects.toThrow();
  });
});
