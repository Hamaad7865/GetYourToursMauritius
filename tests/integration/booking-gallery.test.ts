import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * The customer's private gallery (20261012000000_booking_galleries, tightened by
 * 20261013000000_gallery_ready_flow): one row per photo of one booking. RLS is the whole privacy
 * story — the photo FILES sit in a public bucket, so the rows are the only thing that can withhold
 * their URLs. The owner reads their own booking's photos only once the studio has confirmed the
 * gallery complete (gallery_ready_at), the balance is paid in full and the booking is live; staff
 * read/write everything; the seo role (plus anon) sees nothing.
 */

const CUSTOMER = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
const OTHER = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
const STAFF = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';
const SEO = 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6';

describe('booking gallery: private photos per booking', () => {
  let db: TestDb;
  let ownBooking: string;
  let otherBooking: string;
  let unconfirmedBooking: string;
  let owingBooking: string;
  let cancelledBooking: string;

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
    // Delivered AND paid: the studio confirmed the gallery and the balance is zero (the column default).
    ownBooking = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency, user_id, gallery_ready_at)
         values ('BMT-GAL-1', 'confirmed', 'Gallery Customer', 'gallery@example.com', 65000, 'EUR', $1, now())
         returning id`,
        [CUSTOMER],
      )
    ).rows[0]!.id;
    otherBooking = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency, user_id, gallery_ready_at)
         values ('BMT-GAL-2', 'confirmed', 'Other Customer', 'other@example.com', 65000, 'EUR', $1, now())
         returning id`,
        [OTHER],
      )
    ).rows[0]!.id;
    // Same owner as ownBooking, three ways to still be locked out of the photos.
    // (a) paid in full but the studio has not confirmed the gallery yet.
    unconfirmedBooking = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency, user_id)
         values ('BMT-GAL-3', 'confirmed', 'Gallery Customer', 'gallery@example.com', 65000, 'EUR', $1)
         returning id`,
        [CUSTOMER],
      )
    ).rows[0]!.id;
    // (b) confirmed, but half the price is still owed.
    owingBooking = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency, user_id, gallery_ready_at, balance_due_minor)
         values ('BMT-GAL-4', 'confirmed', 'Gallery Customer', 'gallery@example.com', 65000, 'EUR', $1, now(), 32500)
         returning id`,
        [CUSTOMER],
      )
    ).rows[0]!.id;
    // (c) confirmed and zero owed, but the booking has been cancelled.
    cancelledBooking = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency, user_id, gallery_ready_at)
         values ('BMT-GAL-5', 'cancelled', 'Gallery Customer', 'gallery@example.com', 65000, 'EUR', $1, now())
         returning id`,
        [CUSTOMER],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into booking_photos (booking_id, url, position) values
        ($1, 'https://cdn.example/own-1.jpg', 1),
        ($1, 'https://cdn.example/own-2.jpg', 2),
        ($2, 'https://cdn.example/other-1.jpg', 1),
        ($3, 'https://cdn.example/unconfirmed-1.jpg', 1),
        ($4, 'https://cdn.example/owing-1.jpg', 1),
        ($5, 'https://cdn.example/cancelled-1.jpg', 1)`,
      [ownBooking, otherBooking, unconfirmedBooking, owingBooking, cancelledBooking],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('the owner reads only their own delivered, paid booking’s photos', async () => {
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

  it('the owner reads nothing until the studio confirms the gallery complete', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const rows = await db.pg.query(`select url from booking_photos where booking_id = $1`, [
      unconfirmedBooking,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('the owner reads nothing while the balance is owed — even once the gallery is confirmed', async () => {
    // The lock the booking page draws is only as good as this: the files are in a public bucket, so
    // a row the guest can read is a URL the guest can open, paid or not.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const rows = await db.pg.query(`select url from booking_photos where booking_id = $1`, [
      owingBooking,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('the owner reads nothing on a cancelled booking', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const rows = await db.pg.query(`select url from booking_photos where booking_id = $1`, [
      cancelledBooking,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('the photos open the moment the balance clears', async () => {
    await db.asOwner();
    await db.pg.query(`update bookings set balance_due_minor = 0 where id = $1`, [owingBooking]);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const rows = await db.pg.query<{ url: string }>(
      `select url from booking_photos where booking_id = $1`,
      [owingBooking],
    );
    expect(rows.rows.map((r) => r.url)).toEqual(['https://cdn.example/owing-1.jpg']);
    // Put it back so the staff assertions below see a stable fixture.
    await db.asOwner();
    await db.pg.query(`update bookings set balance_due_minor = 32500 where id = $1`, [
      owingBooking,
    ]);
  });

  it('the owner cannot write anyone’s gallery', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      db.pg.query(`insert into booking_photos (booking_id, url) values ($1, 'https://x/h.jpg')`, [
        ownBooking,
      ]),
    ).rejects.toThrow();
  });

  it('staff read and write every gallery, delivered or not, paid or not', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const all = await db.pg.query(`select * from booking_photos`);
    // own (2) + other (1) + the unconfirmed / owing / cancelled bookings' one photo each.
    expect(all.rows).toHaveLength(6);
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
