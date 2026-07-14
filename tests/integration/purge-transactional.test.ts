import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';
import { apiBook } from '../db/book';

/**
 * `supabase/purge-transactional.sql` is the one script we point at PRODUCTION that DELETES rows, so it
 * gets a real test rather than a careful read-through. It turns the test-polluted database into a clean
 * production one, and it has exactly two ways to be catastrophic:
 *
 *   1. it deletes something irreplaceable (the hand-built catalogue), or
 *   2. it deletes the owner's own admin login, locking them out of /admin forever.
 *
 * So: build the real schema, fill it with a catalogue + a real booking + payments + the surrounding
 * junk + an admin AND a customer login, run the actual file, and assert both halves — the transactional
 * data is gone, and the catalogue and the admin survived untouched.
 */
const PURGE_SQL = readFileSync(join(process.cwd(), 'supabase', 'purge-transactional.sql'), 'utf8');

const ADMIN_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const CUSTOMER_ID = 'cccccccc-2222-4222-8222-cccccccccccc';

async function count(db: TestDb, table: string, where = ''): Promise<number> {
  const { rows } = await db.pg.query<{ n: number }>(
    `select count(*)::int as n from ${table} ${where}`,
  );
  return rows[0]!.n;
}

/** Catalogue/config tables the purge must leave byte-for-byte alone. */
const MUST_SURVIVE = [
  'activities',
  'activity_options',
  'activity_option_prices',
  'activity_images',
  'categories',
  'operators',
  'rental_vehicles',
  'session_occurrences',
] as const;

describe('purge-transactional.sql — clears the test data, spares the catalogue and the admins', () => {
  let db: TestDb;
  let seed: Awaited<ReturnType<typeof seedOccurrence>>;
  /** Catalogue counts captured immediately BEFORE the purge, so we assert "unchanged", not a magic number. */
  const before: Record<string, number> = {};

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();

    // --- the irreplaceable half: a catalogue + availability -------------------
    seed = await seedOccurrence(db, 10);
    await db.pg.query(
      `insert into activity_images (activity_id, url, alt, position) values ($1, 'https://x/y.jpg', 'y', 0)`,
      [seed.activityId],
    );
    await db.pg.query(`insert into categories (name, slug) values ('Cat', 'cat')`);
    await db.pg.query(
      `insert into rental_vehicles (slug, name, category, seats, daily_rate_minor) values ('c1','Car','car',4,3600)`,
    );

    // --- the two logins: one admin (must survive), one customer (must go) -----
    await db.pg.query(`insert into auth.users (id, email) values ($1, 'owner@bmt.test')`, [
      ADMIN_ID,
    ]);
    await db.pg.query(`insert into auth.users (id, email) values ($1, 'tourist@bmt.test')`, [
      CUSTOMER_ID,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role) values ($1, 'Owner', 'admin')
       on conflict (id) do update set role = 'admin'`,
      [ADMIN_ID],
    );
    await db.pg.query(
      `insert into profiles (id, full_name, role) values ($1, 'Tourist', 'customer')
       on conflict (id) do update set role = 'customer'`,
      [CUSTOMER_ID],
    );

    // --- the transactional half: a REAL booking made by the customer ----------
    await db.as({ sub: CUSTOMER_ID, role: 'authenticated' });
    await apiBook(db, {
      occurrenceId: seed.occurrenceId,
      party: { Adult: 2 },
      customerName: 'Tourist',
      customerEmail: 'tourist@bmt.test',
      source: 'web',
      idempotencyKey: 'purge-test-key-1234',
    });
    await db.asOwner();

    const { rows: bk } = await db.pg.query<{ id: string }>(`select id from bookings limit 1`);
    const bookingId = bk[0]!.id;

    // a payment + event hanging off it (both are ON DELETE CASCADE from bookings)
    const { rows: pay } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor) values ($1, 'idem-1', 15000) returning id`,
      [bookingId],
    );
    await db.pg.query(`insert into payment_events (payment_id, type) values ($1, 'authorized')`, [
      pay[0]!.id,
    ]);

    // an ABANDONED cart hold — no booking_id, so it is NOT reached by the cascade
    await db.pg.query(
      `insert into booking_holds (session_occurrence_id, quantity, expires_at, idempotency_key)
       values ($1, 2, now() + interval '30 minutes', 'abandoned-cart-key-1')`,
      [seed.occurrenceId],
    );

    // Outbox rows. notification_outbox.booking_id is ON DELETE **SET NULL**, not cascade — so deleting
    // the booking would leave these behind. That is exactly why the purge clears the table explicitly.
    await db.pg.query(
      `insert into notification_outbox (channel, recipient, template, booking_id)
       values ('email', 'tourist@bmt.test', 'booking_confirmation', $1)`,
      [bookingId],
    );
    await db.pg.query(
      `insert into notification_outbox (channel, recipient, template)
       values ('whatsapp', 'owner', 'owner_new_booking')`,
    );

    // surrounding junk
    await db.pg.query(`insert into leads (name, contact) values ('Lead', 'l@x.test')`);
    await db.pg.query(
      `insert into rate_limits (bucket, ip, window_start, hits) values ('book', '1.2.3.4', now(), 5)`,
    );

    // sanity: we really did create the things we are about to purge
    expect(await count(db, 'bookings')).toBe(1);
    expect(await count(db, 'booking_items')).toBeGreaterThan(0);
    expect(await count(db, 'payments')).toBe(1);
    expect(await count(db, 'payment_events')).toBe(1);
    expect(await count(db, 'booking_holds')).toBeGreaterThanOrEqual(1);
    expect(await count(db, 'notification_outbox')).toBeGreaterThan(0);

    // Snapshot the catalogue BEFORE the purge, so the assertions below prove "unchanged" rather than
    // matching a magic number (the migrations seed some categories of their own).
    for (const t of MUST_SURVIVE) before[t] = await count(db, t);

    // --- run the ACTUAL production purge file ---------------------------------
    await db.pg.exec(PURGE_SQL);
  });

  afterAll(async () => {
    await db.close();
  });

  it('deletes every booking and everything that cascades from it', async () => {
    expect(await count(db, 'bookings')).toBe(0);
    expect(await count(db, 'booking_items')).toBe(0);
    expect(await count(db, 'payments')).toBe(0);
    expect(await count(db, 'payment_events')).toBe(0);
  });

  it('deletes abandoned cart holds, which have no booking_id to cascade from', async () => {
    expect(await count(db, 'booking_holds')).toBe(0);
  });

  it('clears the outbox, rate limits and leads', async () => {
    expect(await count(db, 'notification_outbox')).toBe(0);
    expect(await count(db, 'rate_limits')).toBe(0);
    expect(await count(db, 'leads')).toBe(0);
  });

  it('KEEPS the catalogue — every row of the part that cannot be re-created', async () => {
    for (const t of MUST_SURVIVE) {
      expect(await count(db, t), `${t} must be untouched by the purge`).toBe(before[t]);
    }
    // and it is genuinely non-empty — a purge that wiped everything would trivially "match" nothing
    expect(before.activities).toBeGreaterThan(0);
    expect(before.activity_images).toBeGreaterThan(0);
  });

  it('KEEPS availability, and the purged bookings release their seats', async () => {
    expect(await count(db, 'session_occurrences')).toBe(before.session_occurrences);
    // Usage is DERIVED (there is no used_capacity column), so with the booking + hold gone the seats
    // are free again — which is exactly why the purge never has to touch session_occurrences.
    const { rows } = await db.pg.query<{ n: number }>(`select used_capacity($1)::int as n`, [
      seed.occurrenceId,
    ]);
    expect(rows[0]!.n).toBe(0);
  });

  it('KEEPS the admin login (both profile and auth user) — never lock the owner out', async () => {
    expect(await count(db, 'profiles', `where id = '${ADMIN_ID}'`)).toBe(1);
    expect(await count(db, 'auth.users', `where id = '${ADMIN_ID}'`)).toBe(1);
    expect(await count(db, 'profiles', `where role <> 'customer'`)).toBe(1);
  });

  it('deletes the test CUSTOMER login (profile and auth user)', async () => {
    expect(await count(db, 'profiles', `where id = '${CUSTOMER_ID}'`)).toBe(0);
    expect(await count(db, 'auth.users', `where id = '${CUSTOMER_ID}'`)).toBe(0);
    expect(await count(db, 'profiles', `where role = 'customer'`)).toBe(0);
  });

  it('is idempotent — re-running it changes nothing and still spares the catalogue', async () => {
    await db.pg.exec(PURGE_SQL);
    expect(await count(db, 'bookings')).toBe(0);
    expect(await count(db, 'activities')).toBe(1);
    expect(await count(db, 'profiles', `where id = '${ADMIN_ID}'`)).toBe(1);
    expect(await count(db, 'auth.users', `where id = '${ADMIN_ID}'`)).toBe(1);
  });
});
