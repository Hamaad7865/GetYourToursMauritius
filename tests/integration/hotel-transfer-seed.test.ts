import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * The migration / catch-up.sql SEEDS a bookable `hotel-transfer` activity + ~6 months of rolling day-slots
 * whenever the 'belle-mare-tours' operator exists (prod). This proves that path end-to-end: insert the
 * operator, apply catch-up.sql, and confirm the activity is a published is_hotel_transfer vehicle product
 * with future availability that books on-site (availability -> api_book) at the band fare — i.e. NO manual
 * publish step is needed, which is what lets the quote console book on-site instead of via WhatsApp.
 */
const CATCH_UP = readFileSync(join(process.cwd(), 'supabase', 'catch-up.sql'), 'utf8');
const CUSTOMER = 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('hotel-transfer seed: catch-up.sql creates a bookable activity when the operator exists', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb(); // migrations applied; the migration seed was a no-op (no operator yet)
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
    await db.pg.exec(CATCH_UP); // operator now present -> the seed creates the activity + day-slots
  });

  afterAll(async () => {
    await db.close();
  });

  it('seeds a published is_hotel_transfer vehicle product with min_advance_days = 0', async () => {
    const { rows } = await db.pg.query<{
      status: string;
      pricing_mode: string;
      is_hotel_transfer: boolean;
      min_advance_days: number;
    }>(
      `select status, pricing_mode, is_hotel_transfer, min_advance_days from activities where slug = 'hotel-transfer'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'published',
      pricing_mode: 'vehicle',
      is_hotel_transfer: true,
      min_advance_days: 0,
    });
  });

  it('materializes rolling future day-slots (≈6 months)', async () => {
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n
         from session_occurrences so
         join activity_options o on o.id = so.activity_option_id
         join activities a on a.id = o.activity_id
        where a.slug = 'hotel-transfer' and so.starts_at > now()`,
    );
    expect(rows[0]!.n).toBeGreaterThan(150);
  });

  it('is bookable on-site via a seeded occurrence — far East→West one-way = €60', async () => {
    const occ = (
      await db.pg.query<{ id: string }>(
        `select so.id
           from session_occurrences so
           join activity_options o on o.id = so.activity_option_id
           join activities a on a.id = o.activity_id
          where a.slug = 'hotel-transfer' and so.starts_at > now()
          order by so.starts_at limit 1`,
      )
    ).rows[0]!.id;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string; totalEur: number }>(db, 'api_book', {
      occurrenceId: occ,
      expectedSlug: 'hotel-transfer',
      party: { 'Per transfer': 2 },
      customerName: 'Seed Tester',
      customerEmail: 'seed@example.com',
      source: 'web',
      idempotencyKey: 'h2h-seed-booking-1',
      pickupSlug: 'lux-belle-mare',
      dropoffSlug: 'paradis-beachcomber',
      tripType: 'one_way',
    });
    expect(booking.totalEur).toBe(60);
  });
});
