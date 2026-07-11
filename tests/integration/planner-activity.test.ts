import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * M3: the planner books a real, seeded "Custom Road Trip" activity through the EXISTING vehicle
 * booking flow. It's pricing_mode='vehicle_custom' (priced from planner_pricing), hidden from the
 * public catalogue (is_custom_planner), and made bookable every day via daily_capacity +
 * materialize_availability. End-to-end against the real schema.
 */
interface BookingDto {
  totalEur: number;
  items: Array<{ priceLabel: string; quantity: number; pax: number | null }>;
}
interface Slot {
  occurrenceId: string;
  seatsLeft: number;
}

async function call<T>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('Custom Road Trip bookable activity', () => {
  let db: TestDb;
  let activityId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    // The Custom Road Trip activity is seed data (not a migration); apply the planner seed.
    await db.pg.exec(readFileSync(join(process.cwd(), 'supabase', 'seed-planner.sql'), 'utf8'));
    const { rows } = await db.pg.query<{ id: string }>(
      `select id from activities where slug = 'custom-road-trip'`,
    );
    activityId = rows[0]?.id ?? '';
  });
  afterAll(async () => {
    await db.close();
  });

  it('is seeded as a hidden, day-bookable vehicle_custom activity with one option', async () => {
    await db.asOwner();
    const { rows } = await db.pg.query<{
      pricing_mode: string;
      is_custom_planner: boolean;
      daily_capacity: number | null;
      status: string;
      options: number;
    }>(
      `select a.pricing_mode, a.is_custom_planner, a.daily_capacity, a.status,
              (select count(*)::int from activity_options o where o.activity_id = a.id) as options
         from activities a where a.slug = 'custom-road-trip'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pricing_mode).toBe('vehicle_custom');
    expect(rows[0]!.is_custom_planner).toBe(true);
    expect(rows[0]!.daily_capacity).toBe(10);
    expect(rows[0]!.status).toBe('published');
    expect(rows[0]!.options).toBe(1);
  });

  it('materializes day-slots and books at the planner vehicle price via the real flow', async () => {
    await db.as({ sub: '00000000-0000-0000-0000-000000000000', role: 'service_role' });
    await call<number>(db, 'materialize_availability', { activityId });

    await db.as(null); // anonymous public
    const slots = await call<Slot[]>(db, 'api_list_availability', { slug: 'custom-road-trip' });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]!.seatsLeft).toBe(10); // capacity counts vehicles

    // api_book is no longer anon-executable (lockdown); the guest path arrives via the server
    // (service_role — auth.uid() null, so the booking stays unowned, exactly as before).
    await db.as({ role: 'service_role' });
    const booking = await call<BookingDto>(db, 'api_book', {
      occurrenceId: slots[0]!.occurrenceId,
      expectedSlug: 'custom-road-trip',
      party: { Adult: 3 },
      customerName: 'Test Traveller',
      customerEmail: 'test@example.com',
      source: 'web',
      idempotencyKey: 'crt-book-1',
    });
    expect(booking.totalEur).toBe(95);
    expect(booking.items[0]!.priceLabel).toBe('Standard car');
    expect(booking.items[0]!.quantity).toBe(1); // one vehicle
    expect(booking.items[0]!.pax).toBe(3);
  });

  it('is hidden from the public catalogue search', async () => {
    await db.as(null);
    const res = await call<{ items: Array<{ slug: string }> }>(db, 'api_search_activities', {
      pageSize: 100,
    });
    expect(res.items.find((i) => i.slug === 'custom-road-trip')).toBeUndefined();
  });
});
