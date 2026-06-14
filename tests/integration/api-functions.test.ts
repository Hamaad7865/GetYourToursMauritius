import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';

const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

const USER = 'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1';

/** Mirrors how the service layer + Supabase client call these: db.rpc(fn, { p }). */
async function rpc<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('api_* service functions', () => {
  let db: TestDb;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    await db.pg.query(`insert into auth.users (id) values ($1)`, [USER]);
    const { rows: op } = await db.pg.query<{ id: string }>(`select id from operators limit 1`);
    await db.pg.query(
      `insert into activities (operator_id, slug, title, category, status)
       values ($1, 'hidden-draft', 'Hidden Draft', 'Island tours', 'draft')`,
      [op[0]!.id],
    );
    const { rows: occ } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    occurrenceId = occ[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('api_search_activities paginates published activities (anon sees no drafts)', async () => {
    await db.as(null);
    const result = await rpc<{ items: unknown[]; total: number; pageSize: number }>(
      db,
      'api_search_activities',
      {
        pageSize: 5,
      },
    );
    expect(result.total).toBe(catalogue.activities.length);
    expect(result.items).toHaveLength(5);
    expect(result.pageSize).toBe(5);
    await db.asOwner();
  });

  it('api_search_activities filters by category', async () => {
    const result = await rpc<{ items: { category: string }[] }>(db, 'api_search_activities', {
      category: 'Catamaran cruises',
      pageSize: 50,
    });
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.category).toBe('Catamaran cruises');
    }
  });

  it('api_get_activity returns detail with options + prices + translations', async () => {
    const detail = await rpc<{
      slug: string;
      options: { prices: { label: string; amountEur: number }[] }[];
      translations: Record<string, unknown>;
    } | null>(db, 'api_get_activity', { slug: 'private-south-tour-with-pickup' });
    expect(detail).not.toBeNull();
    expect(detail!.slug).toBe('private-south-tour-with-pickup');
    expect(detail!.options[0]!.prices[0]!.amountEur).toBe(110);
    expect(detail!.translations).toHaveProperty('fr');
  });

  it('api_get_activity hides a draft from anon', async () => {
    await db.as(null);
    const detail = await rpc(db, 'api_get_activity', { slug: 'hidden-draft' });
    expect(detail).toBeNull();
    await db.asOwner();
  });

  it('api_list_availability returns occurrences with live seats_left', async () => {
    const slots = await rpc<{ occurrenceId: string; seatsLeft: number; capacity: number }[]>(
      db,
      'api_list_availability',
      { slug: 'private-south-tour-with-pickup' },
    );
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]!.seatsLeft).toBe(slots[0]!.capacity);
  });

  it('api_book → api_create_payment → api_get_booking, with DB-sourced amounts', async () => {
    await db.as({ sub: USER, role: 'authenticated' });
    const booking = await rpc<{ ref: string; status: string }>(db, 'api_book', {
      occurrenceId,
      party: { 'Private group': 1 },
      customerName: 'Marie',
      customerEmail: 'marie@example.com',
      idempotencyKey: 'api-book-1',
    });
    expect(booking.status).toBe('payment_pending');

    const payment = await rpc<{ paymentId: string; amountMinor: number | string }>(
      db,
      'api_create_payment',
      {
        bookingRef: booking.ref,
        idempotencyKey: 'api-pay-1',
      },
    );
    expect(Number(payment.amountMinor)).toBe(11000);

    const status = await rpc<{ ref: string; totalEur: number }>(db, 'api_get_booking', {
      ref: booking.ref,
    });
    expect(status.ref).toBe(booking.ref);
    expect(status.totalEur).toBe(110);
    await db.asOwner();
  });

  it('api_create_payment refuses an anonymous caller (a ref is not a bearer token)', async () => {
    await db.as(null);
    const booking = await rpc<{ ref: string }>(db, 'api_book', {
      occurrenceId,
      party: { 'Private group': 1 },
      customerName: 'Guest',
      customerEmail: 'guest@example.com',
      idempotencyKey: 'guest-book-1',
    });
    await expect(
      rpc(db, 'api_create_payment', { bookingRef: booking.ref, idempotencyKey: 'guest-pay-1' }),
    ).rejects.toThrow(/forbidden/);
    await db.asOwner();
  });

  it('api_capture_lead inserts a lead', async () => {
    await db.as(null);
    const lead = await rpc<{ id: string; status: string }>(db, 'api_capture_lead', {
      name: 'Walk-in',
      contact: 'walkin@example.com',
    });
    expect(lead.status).toBe('new');
    await db.asOwner();
  });
});
