import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * The customer's private gallery (20261012000000_booking_galleries): one row per photo of one
 * booking. RLS is the whole privacy story — the owner reads only their own booking's photos,
 * staff read/write everything, and the seo role (plus anon) sees nothing.
 */

const CUSTOMER = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
const OTHER = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
const STAFF = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';
const SEO = 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6';

describe('booking gallery: private photos per booking', () => {
  let db: TestDb;
  let ownBooking: string;
  let otherBooking: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2), ($3), ($4)`, [
      CUSTOMER,
      OTHER,
      STAFF,
      SEO,
    ]);
    await db.pg.query(
      `insert into profiles (id, role) values ($1, 'customer'), ($2, 'customer'), ($3, 'staff'), ($4, 'seo')`,
      [CUSTOMER, OTHER, STAFF, SEO],
    );
    ownBooking = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency, user_id)
         values ('BMT-GAL-1', 'confirmed', 'Gallery Customer', 'gallery@example.com', 65000, 'EUR', $1)
         returning id`,
        [CUSTOMER],
      )
    ).rows[0]!.id;
    otherBooking = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency, user_id)
         values ('BMT-GAL-2', 'confirmed', 'Other Customer', 'other@example.com', 65000, 'EUR', $1)
         returning id`,
        [OTHER],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into booking_photos (booking_id, url, position) values
        ($1, 'https://cdn.example/own-1.jpg', 1),
        ($1, 'https://cdn.example/own-2.jpg', 2),
        ($2, 'https://cdn.example/other-1.jpg', 1)`,
      [ownBooking, otherBooking],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('the owner reads only their own booking’s photos', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const own = await db.pg.query<{ url: string }>(
      `select url from booking_photos where booking_id = $1 order by position`,
      [ownBooking],
    );
    expect(own.rows.map((r) => r.url)).toEqual([
      'https://cdn.example/own-1.jpg',
      'https://cdn.example/own-2.jpg',
    ]);
    const other = await db.pg.query(`select * from booking_photos where booking_id = $1`, [
      otherBooking,
    ]);
    expect(other.rows).toHaveLength(0);
  });

  it('the owner cannot write anyone’s gallery', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      db.pg.query(`insert into booking_photos (booking_id, url) values ($1, 'https://x/h.jpg')`, [
        ownBooking,
      ]),
    ).rejects.toThrow();
  });

  it('staff read and write every gallery', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const all = await db.pg.query(`select * from booking_photos`);
    expect(all.rows).toHaveLength(3);
    await db.pg.query(
      `insert into booking_photos (booking_id, url, position) values ($1, 'https://x/staff.jpg', 3)`,
      [otherBooking],
    );
    await db.pg.query(`delete from booking_photos where url = 'https://x/staff.jpg'`);
  });

  it('the seo role and anon see no gallery photos', async () => {
    await db.as({ sub: SEO, role: 'authenticated' });
    expect((await db.pg.query(`select * from booking_photos`)).rows).toHaveLength(0);
    // Anon holds no grant on the table at all, so the read is refused rather than emptied.
    await db.as(null);
    await expect(db.pg.query(`select * from booking_photos`)).rejects.toThrow();
  });
});
